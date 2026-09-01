<#
.SYNOPSIS
  启动仅绑定本机 loopback 的 BGE-M3 Embedding Worker。

.DESCRIPTION
  服务强制离线加载已有权重，不会下载模型，也不属于线上 Docker Compose。
  CUDA 可用时自动使用 fp16；否则安全回退到 CPU 离线推理。
#>
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)] [int]$Port = 8787,
  [ValidateSet("auto", "cuda", "cpu")] [string]$Device = "auto",
  [string]$ModelPath = "",
  [ValidateRange(1, 64)] [int]$BatchSize = 16
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$workerDirectory = Join-Path $projectRoot "workers\bge-m3"
if (-not (Test-Path -LiteralPath (Join-Path $workerDirectory "app.py"))) {
  throw "未找到 BGE-M3 worker：$workerDirectory"
}

$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:USE_TF = "0"
$env:USE_FLAX = "0"
$env:BGE_M3_DEVICE = $Device
$env:BGE_M3_BATCH_SIZE = "$BatchSize"
if (-not [string]::IsNullOrWhiteSpace($ModelPath)) { $env:BGE_M3_MODEL_PATH = $ModelPath }

& python -m uvicorn app:app --app-dir $workerDirectory --host 127.0.0.1 --port $Port
