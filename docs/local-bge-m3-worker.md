# 本地 BGE-M3 Embedding Worker

线上默认走 Cloudmist 的 `gemini-embedding-2-preview` 和远程 Reranker。本文件的 BGE-M3 worker 只用于有 GPU 的开发机离线生成向量：不加入服务器 Docker Compose，不上传模型权重，也不会让云服务器依赖本机开机。

## 安全与运行边界

- 只监听 `127.0.0.1`，没有公网端口；
- 只提供固定 `POST /v1/embeddings`，不能读取文件、访问 URL 或切换任意模型；
- 强制 `HF_HUB_OFFLINE=1` 和 `TRANSFORMERS_OFFLINE=1`；缓存缺失时响应 `503`，不下载权重；
- 可设置 `LOCAL_BGE_M3_WORKER_TOKEN`，Next 端会以 Bearer Token 调用；
- CUDA 可用时使用 fp16 与小批处理，CPU 回退只适合离线建索引，不能放进用户交互热路径。

## 当前机器检查

已检测到 RTX 4060 Laptop GPU（8 GiB）。Hugging Face 缓存只有 `models--BAAI--bge-m3/refs/main` 指针，尚未发现带 `config.json` 的完整 `snapshots/<revision>` 目录。因此 worker 可以安全启动和健康检查，但首个 Embedding 请求会返回未就绪，不能声称 BGE-M3 已加载。

## 启动与验证

```powershell
# 仅安装 Python 运行依赖；不会下载 BGE-M3 权重
python -m pip install -r workers/bge-m3/requirements.txt

# 自动选择 CUDA/CPU，服务只监听 127.0.0.1:8787
./scripts/start-bge-m3-worker.ps1

# 模型位于其他本机目录时，明确指定完整模型目录
./scripts/start-bge-m3-worker.ps1 -Device cuda -ModelPath 'D:\models\bge-m3'

Invoke-RestMethod http://127.0.0.1:8787/healthz
Invoke-RestMethod http://127.0.0.1:8787/v1/embeddings -Method Post -ContentType 'application/json' -Body '{"model":"BAAI/bge-m3","input":["政策和企业调研"]}'
```

GPU 可用时 `/healthz` 返回 `device=cuda`、`precision=fp16`。`ok` 只表示 HTTP 进程仍存活，`ready` 才表示本机有完整模型可加载；Worker 延迟加载模型，所以 `ready=true` 且刚启动 `loaded=false` 正常。`model_cached=false`/`ready=false` 则代表必须先提供完整本地模型目录。

## Next 切换

默认线上配置：

```dotenv
EMBEDDING_PROVIDER=remote
EMBEDDING_API_BASE_URL=https://v2.cloudmist.cloud/v1
EMBEDDING_MODEL=gemini-embedding-2-preview
EMBEDDING_DIMENSIONS=3072
RERANK_API_BASE_URL=https://v2.cloudmist.cloud/v1
RERANK_MODEL=qwen3-rerank
RERANK_FALLBACK_MODELS=Pro/BAAI/bge-reranker-v2-m3,BAAI/bge-reranker-v2-m3
```

仅开发机需要切换时：

```dotenv
EMBEDDING_PROVIDER=local_bge_m3
LOCAL_BGE_M3_WORKER_URL=http://127.0.0.1:8787
LOCAL_BGE_M3_MODEL=BAAI/bge-m3
LOCAL_BGE_M3_WORKER_TOKEN=
```

Rerank 优先 `qwen3-rerank`。遇到 `429`、超时、`5xx` 或格式异常时，Provider 依次尝试两个 BGE Reranker；都失败或没有 Key 时返回 `degraded`，保持 FTS/RRF/元数据上游排序，不伪造精排成功。
