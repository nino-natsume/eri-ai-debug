#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$ResetConfig
)
$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) { Write-Host "[eri-ai-debug] $Message" -ForegroundColor Cyan }
function Write-Fail([string]$Message) { Write-Host "[eri-ai-debug] ERROR: $Message" -ForegroundColor Red; exit 1 }

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageJson = Join-Path $ProjectRoot 'package.json'
$Entry = Join-Path $ProjectRoot 'index.js'

if (-not (Test-Path $PackageJson) -or -not (Test-Path $Entry)) {
    Write-Fail '请从完整 eri-ai-debug 源码目录运行 install-eri.ps1；单文件安装请使用 npm install -g eri-ai-debug。'
}

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node) { Write-Fail '未检测到 Node.js。请安装 Node.js 18 或更高版本。' }
if (-not $npm) { Write-Fail '未检测到 npm。请先修复 Node.js/npm 安装。' }

$nodeVersionText = (& node -p "process.versions.node" 2>$null).Trim()
try { $nodeVersion = [version]$nodeVersionText } catch { Write-Fail "无法读取 Node.js 版本：$nodeVersionText" }
if ($nodeVersion -lt [version]'18.0') { Write-Fail "需要 Node.js >= 18，当前为 $nodeVersionText" }

Write-Info "源码目录：$ProjectRoot"
Write-Info "Node.js：$nodeVersionText"
Write-Info "npm：$((& npm --version 2>$null).Trim())"
if ($CheckOnly) {
    Write-Info '只读检查完成，没有修改系统或用户配置。'
    exit 0
}

Push-Location $ProjectRoot
try {
    & npm link
    if ($LASTEXITCODE -ne 0) { Write-Fail 'npm link 失败；请检查 npm 全局 prefix 的写入权限。' }
} finally {
    Pop-Location
}

$eri = Get-Command eri-ai-debug -ErrorAction SilentlyContinue
if (-not $eri) { Write-Fail '安装后仍找不到 eri-ai-debug 命令；请检查 npm global bin 是否在 PATH 中。' }
Write-Info "CLI 已安装：$($eri.Source)"
if ($ResetConfig) {
    & eri-ai-debug init --reset-config
} else {
    & eri-ai-debug init
}
Write-Info '完成。执行 eri-ai-debug 进入 TUI，执行 eri-ai-debug connect 连接 OpenCode。'
