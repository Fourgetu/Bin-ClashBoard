#requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$DataDirectory,
  [Parameter(Mandatory)][string]$ComposeFile,
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]*$')][string]$Service = 'bin-clashboard',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$clientDirectory = (Resolve-Path -LiteralPath $DataDirectory).Path
$composePath = (Resolve-Path -LiteralPath $ComposeFile).Path
if (-not (Test-Path -LiteralPath $clientDirectory -PathType Container)) { throw 'DataDirectory 必须为目录。' }
if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) { throw 'ComposeFile 必须为现有 Compose 文件。' }
if (-not (Test-Path -LiteralPath (Join-Path $clientDirectory 'service_core_runtime_profile.yaml') -PathType Leaf)) {
  throw '目录内未找到 service_core_runtime_profile.yaml。请先启动 Clash Mi，并选择其完整数据目录。'
}
$overridePath = Join-Path (Get-Item -LiteralPath $composePath).DirectoryName 'compose.clashmi.local.yaml'
# JSON strings are valid YAML scalars. Escape Compose dollar interpolation too.
$quotedDirectory = ConvertTo-Json -InputObject ($clientDirectory.Replace('\', '/').Replace('$', '$$')) -Compress
$yaml = @"
services:
  ${Service}:
    volumes:
      - type: bind
        source: $quotedDirectory
        target: /app/clashmi
        read_only: true
        bind:
          create_host_path: false
"@
if ((Test-Path -LiteralPath $overridePath) -and [IO.File]::ReadAllText($overridePath) -ne $yaml) {
  throw "已有不同内容的 $overridePath，未覆盖。请检查该文件后再运行。"
}
if (-not (Test-Path -LiteralPath $overridePath)) { [IO.File]::WriteAllText($overridePath, $yaml, [Text.UTF8Encoding]::new($false)) }
Write-Host "已生成只读挂载配置：$overridePath"
Write-Host '此配置保留原 Compose 中的数据挂载。应用时会重建面板容器，期间面板短暂不可用；Clash Mi 文件只读。'
if ($Apply) {
  Get-Command docker -ErrorAction Stop | Out-Null
  & docker compose -f $composePath -f $overridePath config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Compose 配置校验失败，未重建容器。' }
  & docker compose -f $composePath -f $overridePath pull $Service
  if ($LASTEXITCODE -ne 0) { throw '镜像拉取失败，未重建容器。' }
  & docker compose -f $composePath -f $overridePath up -d --no-deps $Service
  if ($LASTEXITCODE -ne 0) { throw '容器更新失败，请检查 Docker 输出。' }
  Write-Host '打开面板 → 修改后端配置 → 节点检测配置 → 连接配置目录。以后更新订阅无需重新导入。'
} else {
  $quotedCompose = "'" + $composePath.Replace("'", "''") + "'"
  $quotedOverride = "'" + $overridePath.Replace("'", "''") + "'"
  Write-Host "运行以下命令应用：`ndocker compose -f $quotedCompose -f $quotedOverride up -d --no-deps $Service"
}
