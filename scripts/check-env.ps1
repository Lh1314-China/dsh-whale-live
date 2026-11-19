<#
.SYNOPSIS
  Environment check for dsh-whale-live.

.DESCRIPTION
  Reports what this machine already has for a stream: Python + edge-tts,
  VTube Studio's plugin port, OBS, Bilibili Livehime, and whether the configured
  files exist. Read-only: it never installs anything and never opens a stream.
#>
[CmdletBinding()]
param(
  [string]$Python = '',
  [string]$CredentialFile = '',
  [int]$VtsPort = 8001
)

$ErrorActionPreference = 'Continue'

function Write-Head([string]$text) { Write-Host ''; Write-Host $text; Write-Host ('-' * $text.Length) }
function Find-Command([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}
function Show-Row([string]$name, [string]$value, [string]$hint) {
  if ($value) { Write-Host ('  [ok]   {0,-18} {1}' -f $name, $value) }
  else { Write-Host ('  [--]   {0,-18} {1}' -f $name, $hint) }
}

Write-Host 'dsh-whale-live environment check'

Write-Head 'Python and speech'
$python = $Python
if (-not $python) { $python = Find-Command 'python.exe' }
Show-Row 'python' $python 'not found; needed for edge-tts speech'
if ($python) {
  $hasEdge = $false
  try {
    $probe = & $python -c "import importlib.util; print('yes' if importlib.util.find_spec('edge_tts') else 'no')" 2>$null
    $hasEdge = ($probe -eq 'yes')
  } catch { $hasEdge = $false }
  Show-Row 'edge-tts' $(if ($hasEdge) { 'installed' } else { $null }) 'not installed; run: pip install edge-tts'
}

Write-Head 'Avatar (VTube Studio)'
$vtsUp = $false
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $async = $client.BeginConnect('127.0.0.1', $VtsPort, $null, $null)
  $vtsUp = $async.AsyncWaitHandle.WaitOne(800) -and $client.Connected
  $client.Close()
} catch { $vtsUp = $false }
Show-Row "port $VtsPort" $(if ($vtsUp) { 'open' } else { $null }) 'VTS not running or API disabled'
Write-Host '         Mouth parameter names can be overridden with DSH_WHALE_LIVE_MOUTH_PARAM / DSH_WHALE_LIVE_SMILE_PARAM.'

Write-Head 'Other stream tools (all optional)'
Show-Row 'obs64.exe' (Find-Command 'obs64.exe') 'not on PATH; set obsPath if you want the stage helper'
Show-Row 'livehime.exe' (Find-Command 'livehime.exe') 'not on PATH; set livehimePath if you use it'
Show-Row 'curl.exe' (Find-Command 'curl.exe') 'not found; Bilibili HTTP calls need it'

Write-Head 'Configuration files'
$cred = $CredentialFile
if (-not $cred) { $cred = Join-Path $env:USERPROFILE '.dsh\bili-live\bili_credential.json' }
Show-Row 'credential json' $(if (Test-Path -LiteralPath $cred) { $cred } else { $null }) "not found at $cred; danmaku needs your own login"
$dataDir = Join-Path $env:USERPROFILE '.dsh\whale-live'
Show-Row 'data dir' $(if (Test-Path -LiteralPath $dataDir) { $dataDir } else { $null }) "will be created at $dataDir on first open"

Write-Head 'what this means'
Write-Host '  Nothing above is installed or started by this script. A stream needs:'
Write-Host '    - your own Bilibili room id and login (danmaku)'
Write-Host '    - Python + edge-tts (speech), or your own TTS backend'
Write-Host '    - VTube Studio with API enabled (avatar), optional'
Write-Host '  Details: https://github.com/Lh1314-China/dsh-whale-live#readme'
