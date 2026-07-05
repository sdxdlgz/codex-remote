$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectRoot
"[$(Get-Date -Format o)] starting codex-remote" | Out-File -FilePath (Join-Path $LogDir 'codex-remote.log') -Append -Encoding utf8
npm start *>> (Join-Path $LogDir 'codex-remote.log')

