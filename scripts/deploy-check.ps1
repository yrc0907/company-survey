<#
.SYNOPSIS
  在部署前验证 Docker Compose、服务器 .env 与基础安全配置。

.DESCRIPTION
  此脚本只读取配置键名和校验格式，不输出密码、API Key 或数据库连接值。
  它不会启动、停止或修改任何容器。
#>
[CmdletBinding()]
param(
  [string]$EnvFile = ".env"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.yml"
$resolvedEnvFile = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
  $EnvFile
} else {
  Join-Path $projectRoot $EnvFile
}

function Read-DotEnv {
  param([Parameter(Mandatory = $true)][string]$Path)

  $values = @{}
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      continue
    }

    if ($line -notmatch "^([A-Za-z_][A-Za-z0-9_]*)=(.*)$") {
      throw "无法解析环境变量行，请检查 $Path。"
    }

    $key = $matches[1]
    $value = $matches[2].Trim()
    if (($value.StartsWith("'") -and $value.EndsWith("'")) -or
        ($value.StartsWith('"') -and $value.EndsWith('"'))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }
  return $values
}

function Require-NonEmptyValue {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Values,
    [Parameter(Mandatory = $true)][string]$Key
  )

  if (-not $Values.ContainsKey($Key) -or [string]::IsNullOrWhiteSpace($Values[$Key])) {
    throw "缺少必填配置 $Key。"
  }

  $unsafeMarkers = @("change-this-password", "replace-me", "your-password", "example.com")
  foreach ($marker in $unsafeMarkers) {
    if ($Values[$Key].Contains($marker, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "$Key 仍包含示例占位值，部署前必须替换。"
    }
  }
}

if (-not (Test-Path -LiteralPath $composeFile)) {
  throw "未找到 docker-compose.yml：$composeFile"
}

if (-not (Test-Path -LiteralPath $resolvedEnvFile)) {
  throw "未找到部署环境文件：$resolvedEnvFile。请从 .env.example 复制一份到服务器 .env。"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "未找到 Docker CLI。请先安装 Docker Engine 与 Compose Plugin。"
}

& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose Plugin 不可用。"
}

$values = Read-DotEnv -Path $resolvedEnvFile
foreach ($key in @(
    "DOMAIN",
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "CADDY_BASIC_AUTH_HASH"
  )) {
  Require-NonEmptyValue -Values $values -Key $key
}

if ($values["DOMAIN"] -match "^(localhost|127\\.0\\.0\\.1)$") {
  throw "公网部署必须设置可解析到服务器公网 IP 的 DOMAIN，不能使用 localhost。"
}

if ($values["DATABASE_URL"] -notmatch "@postgres:5432/") {
  throw "DATABASE_URL 必须指向 Compose 内部的 postgres:5432 服务，避免暴露数据库端口。"
}

if ($values["CADDY_BASIC_AUTH_HASH"] -notmatch "^\\$2[aby]\\$") {
  Write-Warning "CADDY_BASIC_AUTH_HASH 不像标准 bcrypt 哈希；请用 caddy hash-password 重新生成后再部署。"
}

foreach ($optionalKey in @("MODEL_API_KEY", "DEEPSEEK_API_KEY")) {
  if (-not $values.ContainsKey($optionalKey) -or [string]::IsNullOrWhiteSpace($values[$optionalKey])) {
    Write-Warning "$optionalKey 未配置；对应 AI Provider 会以未配置状态降级。"
  }
}

# 只验证 Compose 插值与 YAML，且不会打印渲染后的机密环境变量。
$previousEnvFile = $env:ENV_FILE
$env:ENV_FILE = $resolvedEnvFile
try {
  & docker compose --env-file $resolvedEnvFile config --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose config 校验失败。"
  }
} finally {
  $env:ENV_FILE = $previousEnvFile
}

Write-Host "部署预检通过：Compose、必填配置和基础安全约束均有效。"
