<#
.SYNOPSIS
  以声明式方式检查/（显式确认后）补齐香港 ECS 的最小入站安全组规则。

.DESCRIPTION
  默认是只读计划模式，不会调用任何写入 API。-Apply 只允许新增 TCP 80、443 和
  指定管理网段的 22，不会删除规则；3389、3000、5432 的清理必须人工确认。
  阿里云凭据由本机 aliyun CLI 配置或 RAM 临时凭据提供，脚本不接收、不打印密钥。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SecurityGroupId,

  [string]$RegionId = "cn-hongkong",

  # 例如 203.0.113.8/32。未提供时只检查公网 Web 规则并明确提示 SSH 未收紧。
  [string]$ManagementCidr,

  [switch]$Apply,

  [string]$ConfirmText
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command aliyun -ErrorAction SilentlyContinue)) {
  throw "未找到 aliyun CLI。请在服务器配置短期 RAM 凭据后再运行；本脚本不会替你创建或保存密钥。"
}

if ($Apply -and $ConfirmText -ne "ALLOW-HK-ECS-SECURITY-GROUP") {
  throw "-Apply 必须同时提供 -ConfirmText ALLOW-HK-ECS-SECURITY-GROUP。默认计划模式不会修改云资源。"
}

if ($ManagementCidr -and $ManagementCidr -notmatch "^(?:\d{1,3}\.){3}\d{1,3}/(?:32|[0-2]?\d)$") {
  throw "ManagementCidr 必须是 IPv4 CIDR，例如 203.0.113.8/32。"
}

function Invoke-AliyunJson {
  # 输入不含凭据的阿里云 CLI 参数，返回 JSON 对象；失败时抛出脱敏错误。
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $raw = & aliyun @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "阿里云 CLI 调用失败（未显示凭据）：$($Arguments[0..1] -join ' ')"
  }
  if ([string]::IsNullOrWhiteSpace(($raw -join ""))) {
    return $null
  }
  return ($raw -join "") | ConvertFrom-Json
}

function Get-Permissions {
  # 查询指定安全组入站规则，供声明式差异检查使用；不执行写操作。
  $response = Invoke-AliyunJson -Arguments @(
    "ecs", "DescribeSecurityGroupAttribute",
    "--RegionId", $RegionId,
    "--SecurityGroupId", $SecurityGroupId,
    "--Direction", "ingress"
  )
  if ($null -eq $response) {
    return @()
  }
  $permissionsProperty = $response.PSObject.Properties["Permissions"]
  if ($null -eq $permissionsProperty -or $null -eq $permissionsProperty.Value) {
    return @()
  }
  $permission = $permissionsProperty.Value.Permission
  if ($null -eq $permission) {
    return @()
  }
  return @($permission)
}

function Test-Rule {
  # 根据协议、端口和来源匹配允许规则，避免重复授权同一条入站规则。
  param(
    [Parameter(Mandatory = $true)][object[]]$Permissions,
    [Parameter(Mandatory = $true)][string]$PortRange,
    [Parameter(Mandatory = $true)][string]$SourceCidrIp
  )

  return $null -ne ($Permissions | Where-Object {
      $_.IpProtocol -eq "tcp" -and
      $_.PortRange -eq $PortRange -and
      $_.SourceCidrIp -eq $SourceCidrIp -and
      $_.Policy -ne "Drop"
    } | Select-Object -First 1)
}

$desired = @(
  [pscustomobject]@{ PortRange = "80/80"; SourceCidrIp = "0.0.0.0/0"; Description = "research web HTTP" },
  [pscustomobject]@{ PortRange = "443/443"; SourceCidrIp = "0.0.0.0/0"; Description = "research web HTTPS" }
)
if ($ManagementCidr) {
  $desired += [pscustomobject]@{ PortRange = "22/22"; SourceCidrIp = $ManagementCidr; Description = "SSH management CIDR" }
}

$permissions = @(Get-Permissions)
Write-Host "目标地域：$RegionId；安全组：$SecurityGroupId"
if (-not $ManagementCidr) {
  Write-Warning "未提供 ManagementCidr：不会开放 SSH 规则。请人工将 22 限制到固定管理 IP/32。"
}

foreach ($rule in $desired) {
  if (Test-Rule -Permissions $permissions -PortRange $rule.PortRange -SourceCidrIp $rule.SourceCidrIp) {
    Write-Host "PASS 已存在 tcp $($rule.PortRange) <- $($rule.SourceCidrIp)"
    continue
  }

  Write-Host "DRIFT 缺少 tcp $($rule.PortRange) <- $($rule.SourceCidrIp)"
  if (-not $Apply) {
    Write-Host "PLAN aliyun ecs AuthorizeSecurityGroup ...（未执行）"
    continue
  }

  $arguments = @(
    "ecs", "AuthorizeSecurityGroup",
    "--RegionId", $RegionId,
    "--SecurityGroupId", $SecurityGroupId,
    "--IpProtocol", "tcp",
    "--PortRange", $rule.PortRange,
    "--SourceCidrIp", $rule.SourceCidrIp,
    "--Policy", "accept",
    "--Priority", "100",
    "--Description", $rule.Description
  )
  $null = Invoke-AliyunJson -Arguments $arguments
  Write-Host "APPLIED 新增 tcp $($rule.PortRange) <- $($rule.SourceCidrIp)"
}

Write-Host "安全提醒：脚本从不自动删除 3389、3000 或 5432；请在控制台/变更流程中人工核对并删除。"
Write-Host "安全提醒：确认 22 仅允许可信固定管理网段，80/443 才允许公网访问。"
