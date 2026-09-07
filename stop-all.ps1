$ErrorActionPreference = 'Continue'

function Get-ListenPids([int]$Port) {
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($line in (netstat -ano)) {
    if ($line -notmatch 'LISTENING') { continue }
    if ($line -notmatch ":${Port}\s") { continue }
    if ($line -match '\s(\d+)\s*$') {
      [void]$ids.Add([int]$Matches[1])
    }
  }
  return @($ids)
}

function Stop-ListenPort([int]$Port) {
  foreach ($procId in (Get-ListenPids $Port)) {
    if ($procId -le 4) { continue }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    Write-Host ("Stop {0} PID {1} (port {2})" -f $proc.ProcessName, $procId, $Port) -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

Write-Host 'Stopping Party School API / Admin / Mobile ...'
Stop-ListenPort 3000
Stop-ListenPort 5173
Stop-ListenPort 5174
Write-Host 'Freed ports 3000, 5173, 5174. MySQL was not stopped.' -ForegroundColor Green
