"""本地 BGE-M3 Embedding Worker。

该服务只监听 loopback，绝不加入线上 Docker Compose。它只从已有本机目录离线加载模型，
优先 CUDA + fp16；CUDA 不可用时安全回退 CPU，模型缓存缺失时拒绝请求而不是下载权重。
"""

from __future__ import annotations

import asyncio
import os
import secrets
from pathlib import Path
from typing import Any, Literal

# 先于 transformers/sentence-transformers 导入设置离线模式，避免缺失缓存时发生隐式下载。
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
# 本机可能预装 Keras 3；worker 只使用 PyTorch，显式禁用 TF/Flax 防止 transformers 误加载不兼容后端。
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("USE_FLAX", "0")

import torch
from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sentence_transformers import SentenceTransformer

DEFAULT_CACHE_ROOT = Path.home() / ".cache" / "huggingface" / "hub" / "models--BAAI--bge-m3"
MAX_BATCH = 64
MAX_TEXT_LENGTH = 24_000


class EmbeddingRequest(BaseModel):
    """OpenAI-compatible 的固定入参，只接受文本，禁止路径、URL 和任意模型名。"""

    model: str = "BAAI/bge-m3"
    input: list[str] = Field(min_length=1, max_length=MAX_BATCH)
    encoding_format: Literal["float"] = "float"

    @field_validator("input")
    @classmethod
    def validate_texts(cls, texts: list[str]) -> list[str]:
        if any(not text.strip() or len(text) > MAX_TEXT_LENGTH for text in texts):
            raise ValueError(f"每条文本必须非空且不超过 {MAX_TEXT_LENGTH} 个字符")
        return texts


class EmbeddingWorker:
    """延迟加载本地模型，首个 embedding 请求才占用 GPU，healthz 不触发权重加载。"""

    def __init__(self) -> None:
        self._model: SentenceTransformer | None = None
        self._load_lock = asyncio.Lock()
        self.device = self._select_device()
        self.model_path = self._resolve_model_path()
        self.error: str | None = None

    @staticmethod
    def _select_device() -> str:
        """优先 CUDA；显卡驱动不可用时明确 CPU 回退而非服务启动失败。"""
        requested = os.getenv("BGE_M3_DEVICE", "auto").strip().lower()
        if requested in {"cuda", "cpu"}:
            return "cpu" if requested == "cuda" and not torch.cuda.is_available() else requested
        return "cuda" if torch.cuda.is_available() else "cpu"

    @staticmethod
    def _resolve_model_path() -> Path | None:
        """只接受本机含 config.json 的完整目录；不存在时不进行 Hub 下载。"""
        configured = os.getenv("BGE_M3_MODEL_PATH", "").strip()
        if configured:
            path = Path(configured).expanduser()
            return path if (path / "config.json").is_file() else None

        snapshots = DEFAULT_CACHE_ROOT / "snapshots"
        if not snapshots.is_dir():
            return None
        candidates = sorted((path for path in snapshots.iterdir() if (path / "config.json").is_file()), key=lambda path: path.name)
        return candidates[-1] if candidates else None

    async def get_model(self) -> SentenceTransformer:
        """加载离线权重；CUDA 场景转 fp16 以降低 RTX 4060 显存压力。"""
        if self._model is not None:
            return self._model
        async with self._load_lock:
            if self._model is not None:
                return self._model
            if self.model_path is None:
                self.error = "未找到完整 BGE-M3 本地缓存；请设置 BGE_M3_MODEL_PATH，不会自动下载。"
                raise RuntimeError(self.error)
            try:
                model = SentenceTransformer(str(self.model_path), device=self.device, local_files_only=True)
                if self.device == "cuda":
                    model.half()
                self._model = model
                self.error = None
                return model
            except Exception as error:
                # 仅保留错误类型，避免将文件路径或底层环境细节回显给 HTTP 调用方。
                self.error = f"BGE-M3 离线加载失败：{type(error).__name__}"
                raise RuntimeError(self.error) from error

    async def encode(self, texts: list[str]) -> list[list[float]]:
        """将阻塞推理放入线程，避免卡住 healthz 和下一次鉴权请求。"""
        model = await self.get_model()
        try:
            requested_batch_size = int(os.getenv("BGE_M3_BATCH_SIZE", "16"))
        except ValueError:
            requested_batch_size = 16
        batch_size = min(max(requested_batch_size, 1), MAX_BATCH)

        def run() -> list[list[float]]:
            vectors = model.encode(texts, batch_size=batch_size, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
            return [vector.astype(float).tolist() for vector in vectors]

        return await asyncio.to_thread(run)


worker = EmbeddingWorker()
app = FastAPI(title="Local BGE-M3 Embedding Worker", docs_url=None, redoc_url=None)


def verify_bearer_token(authorization: str | None) -> None:
    """可选 loopback Token，防止同机其他进程误用本地 Embedding 接口。"""
    configured = os.getenv("LOCAL_BGE_M3_WORKER_TOKEN", "").strip()
    if not configured:
        return
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not secrets.compare_digest(configured, supplied):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="本地 Worker 鉴权失败")


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    """只暴露状态和设备选择，不返回路径、Token、输入文本或模型内部细节。"""
    return {
        # ok 是 HTTP 进程存活；ready 才表示可接收 Embedding 请求，二者不能混为一谈。
        "ok": worker.error is None,
        "ready": worker.model_path is not None and worker.error is None,
        "model": "BAAI/bge-m3",
        "model_cached": worker.model_path is not None,
        "loaded": worker._model is not None,
        "device": worker.device,
        "precision": "fp16" if worker.device == "cuda" else "fp32",
        "error": worker.error,
    }


@app.post("/v1/embeddings")
async def create_embeddings(payload: EmbeddingRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """返回 `data[index].embedding`；仅本机 BAAI/bge-m3 可以被该 worker 调用。"""
    verify_bearer_token(authorization)
    if payload.model not in {"BAAI/bge-m3", "bge-m3"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="本地 Worker 仅支持 BAAI/bge-m3")
    try:
        vectors = await worker.encode(payload.input)
    except RuntimeError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="本地 BGE-M3 模型尚不可用") from None
    return {
        "object": "list",
        "model": "BAAI/bge-m3",
        "data": [{"object": "embedding", "index": index, "embedding": vector} for index, vector in enumerate(vectors)],
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }
