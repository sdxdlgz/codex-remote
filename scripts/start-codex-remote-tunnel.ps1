$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ProjectRoot 'logs'
$ConfigPath = Join-Path $env:USERPROFILE '.cloudflared\codex-remote.yml'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
"[$(Get-Date -Format o)] starting codex-remote tunnel" | Out-File -FilePath (Join-Path $LogDir 'cloudflared-codex-remote.log') -Append -Encoding utf8
cloudflared tunnel --config $ConfigPath run codex-remote *>> (Join-Path $LogDir 'cloudflared-codex-remote.log')

