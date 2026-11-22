# Start MySQL (best-effort), API, admin, and mobile.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Join-Path $Root 'server'
$AdminDir = Join-Path $Root 'admin'

function Write-Info([string]$Message) { Write-Host $Message -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host $Message -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host $Message -ForegroundColor Yellow }

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
    Write-Warn ("Free port {0} (stop {1} PID {2})" -f $Port, $proc.ProcessName, $procId)
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}

function Test-PortOpen([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400)
    if ($ok -and $client.Connected) {
      $client.EndConnect($iar)
      $client.Close()
      return $true
    }
    $client.Close()
  } catch { }
  return $false
}

function Wait-Port([int]$Port, [int]$Seconds = 25) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $Port) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

function Get-DockerNetworkJson([string]$Name) {
  return (docker inspect $Name --format '{{json .NetworkSettings.Networks}}' 2>$null | Out-String).Trim()
}

function Repair-DockerNetwork([string]$Name) {
  # After a Docker Desktop restart a container can be Up yet attached to no network:
  # no IP, -p mappings inactive, host cannot reach 3306. docker restart does not fix
  # this; the container has to be connected back to bridge explicitly.
  if ((Get-DockerNetworkJson $Name) -ne '{}') { return $false }
  Write-Warn ("Container {0} is up but attached to no network; connecting to bridge ..." -f $Name)
  docker network connect bridge $Name 2>$null | Out-Null
  if ((Get-DockerNetworkJson $Name) -eq '{}') {
    Write-Warn ("Cannot attach {0} to the bridge network. Check Docker Desktop." -f $Name)
    return $false
  }
  Write-Ok ("Container {0} attached to bridge network" -f $Name)
  return $true
}

function Start-MysqlIfNeeded {
  if (Test-PortOpen 3306) {
    Write-Ok 'MySQL is already listening on 3306'
    return
  }

  $services = Get-Service -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match 'mysql|mariadb' -or $_.DisplayName -match 'MySQL|MariaDB'
  }
  foreach ($svc in $services) {
    if ($svc.Status -eq 'Running') { continue }
    Write-Info ("Starting Windows service {0} ..." -f $svc.Name)
    try {
      Start-Service $svc.Name -ErrorAction Stop
    } catch {
      Write-Warn ("Cannot start {0}: {1}" -f $svc.Name, $_.Exception.Message)
    }
  }

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if ($docker -and -not (Test-PortOpen 3306)) {
    $names = docker ps -a --format '{{.Names}} {{.Status}}' 2>$null
    foreach ($row in $names) {
      if ($row -notmatch 'mysql|mariadb|party') { continue }
      $name = ($row -split '\s+')[0]
      Write-Info ("Starting Docker container {0} ..." -f $name)
      docker start $name | Out-Null
      if (-not (Wait-Port 3306 8)) { [void](Repair-DockerNetwork $name) }
    }
  }

  $xampp = @(
    'C:\xampp\mysql_start.bat',
    'C:\xampp\mysql\bin\mysqld.exe',
    'D:\xampp\mysql_start.bat'
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($xampp -and -not (Test-PortOpen 3306)) {
    Write-Info ("Starting XAMPP MySQL: {0}" -f $xampp)
    if ($xampp.EndsWith('.bat')) {
      Start-Process -FilePath $xampp -WindowStyle Minimized
    } else {
      Start-Process -FilePath $xampp -ArgumentList '--console' -WindowStyle Minimized
    }
  }

  if (Wait-Port 3306 20) {
    Write-Ok 'MySQL is ready on 3306'
  } else {
    Write-Warn 'MySQL not found on 127.0.0.1:3306. Start it manually or login/API will fail.'
  }
}

function Start-ServiceWindow([string]$Title, [string]$WorkDir, [string]$Command) {
  $escapedDir = $WorkDir.Replace("'", "''")
  $escapedTitle = $Title.Replace("'", "''")
  $escapedCmd = $Command.Replace("'", "''")
  $ps = @"
`$Host.UI.RawUI.WindowTitle = '$escapedTitle'
Set-Location -LiteralPath '$escapedDir'
$escapedCmd
"@
  Start-Process powershell.exe -ArgumentList @(
    '-NoExit',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $ps
  )
}

Write-Host ''
Write-Host '======== Party School launcher ========' -ForegroundColor Magenta
Write-Host ("Root: {0}" -f $Root)
Write-Host ''

if (-not (Test-Path (Join-Path $ServerDir 'src\app.js'))) {
  Write-Host ("Backend not found: {0}" -f $ServerDir) -ForegroundColor Red
  exit 1
}

Start-MysqlIfNeeded

Write-Info 'Stopping old processes on 3001 / 5173 / 5174 ...'
Stop-ListenPort 3001
Stop-ListenPort 5173
Stop-ListenPort 5174
Start-Sleep -Seconds 1

Write-Info 'Starting backend, admin, mobile (one window each) ...'
Start-ServiceWindow 'PartySchool API :3001' $ServerDir 'node src/app.js'
Start-ServiceWindow 'PartySchool Admin :5173' $AdminDir 'npm.cmd run dev -- --host 0.0.0.0 --port 5173 --strictPort'
Start-ServiceWindow 'PartySchool Mobile :5174' $Root 'npm.cmd run dev -- --host 0.0.0.0 --port 5174 --strictPort'

$backendOk = Wait-Port 3001 20
$adminOk = Wait-Port 5173 30
$mobileOk = Wait-Port 5174 30

Write-Host ''
Write-Host '-------- URLs --------' -ForegroundColor Magenta
if ($backendOk) { Write-Ok  'API      http://127.0.0.1:3001/api' } else { Write-Warn 'API is not ready on port 3001. Check the API window.' }
if ($adminOk)   { Write-Ok  'Admin    http://localhost:5173/' } else { Write-Warn 'Admin is not ready on port 5173. Check the Admin window.' }
if ($mobileOk)  { Write-Ok  'Mobile   http://localhost:5174/' } else { Write-Warn 'Mobile is not ready on port 5174. Check the Mobile window.' }
Write-Host 'LAN admin   http://<your-ip>:5173/'
Write-Host 'LAN mobile  http://<your-ip>:5174/'
Write-Host ''
Write-Host 'Demo accounts' -ForegroundColor Magenta
Write-Host '  Admin   admin / admin123'
Write-Host '  Mobile  lisi / admin123'
Write-Host ''
Write-Host 'Close a service window to stop that process. Run this script again to restart.' -ForegroundColor DarkGray
Write-Host ''

if ($adminOk) { Start-Process 'http://localhost:5173/' }
if ($mobileOk) { Start-Process 'http://localhost:5174/' }
