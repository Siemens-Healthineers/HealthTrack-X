param(
    [ValidateRange(1024, 65535)][int]$BackendPort = 8000,
    [ValidateRange(1024, 65535)][int]$FrontendPort = 5173,
    [ValidateRange(1024, 65535)][int]$NatsPort = 4222,
    [ValidateRange(1024, 65535)][int]$MonitorPort = 8222,
    [switch]$NoBrowser,
    [switch]$SmokeTest,
    [switch]$Check,
    [switch]$UseLocalConfiguration
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root '.local'
$children = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$environmentBackup = @{}

function Set-LocalEnvironment([string]$Name, [string]$Value) {
    $environmentBackup[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $Executable (exit $LASTEXITCODE)"
    }
}

function Test-LocalPort([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.ExclusiveAddressUse = $true
    try {
        $listener.Start()
        return $true
    }
    catch [System.Net.Sockets.SocketException] {
        return $false
    }
    finally {
        $listener.Stop()
    }
}

function Start-ServiceProcess([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$Directory) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $runtime "$Name.log") -RedirectStandardError (Join-Path $runtime "$Name.error.log")
    $children.Add($process)
    return $process
}

function Wait-Endpoint([string]$Url, [System.Diagnostics.Process]$Process) {
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) { throw "Service exited before ready: $Url. See $runtime for logs." }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        }
        catch [System.Net.WebException] {}
    }
    throw "Service readiness timed out: $Url. See $runtime for logs."
}

try {
    Set-Location $root
    Write-Host 'HealthTrack-X: native Windows start (no Docker / Rancher / Kubernetes)'
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (!$node -or !$npm) { throw 'Install Node.js 22 LTS (including npm), then reopen START.bat.' }
    $nodeMajor = [int]((& $node -p 'process.versions.node').Split('.')[0])
    if ($nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }

    $python = Join-Path $root '.venv\Scripts\python.exe'
    if (!(Test-Path $python)) {
        $pythonCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        $pythonArguments = @('-3')
        if (!$pythonCommand) {
            $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
            $pythonArguments = @()
        }
        if (!$pythonCommand) { throw 'Install Python 3.12 or newer (including pip), then reopen START.bat.' }
        Invoke-Checked $pythonCommand.Source ($pythonArguments + @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'))
        if (!$Check) { Invoke-Checked $pythonCommand.Source ($pythonArguments + @('-m', 'venv', (Join-Path $root '.venv'))) }
    }
    else {
        Invoke-Checked $python @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)')
    }

    $ports = @($BackendPort, $FrontendPort, $NatsPort, $MonitorPort)
    if (@($ports | Select-Object -Unique).Count -ne 4) { throw 'All four service ports must be different.' }
    foreach ($name in @('BackendPort', 'FrontendPort', 'NatsPort', 'MonitorPort')) {
        $preferredPort = Get-Variable -Name $name -ValueOnly
        if (Test-LocalPort $preferredPort) { continue }
        if ($PSBoundParameters.ContainsKey($name)) {
            throw "Explicit $name $preferredPort is unavailable. Choose another port or omit -$name for automatic selection. No existing process was stopped."
        }
        $selectedPort = $null
        for ($candidate = $preferredPort + 1; $candidate -le [Math]::Min($preferredPort + 1000, 65535); $candidate++) {
            if ($candidate -notin $ports -and (Test-LocalPort $candidate)) {
                $selectedPort = $candidate
                break
            }
        }
        if ($null -eq $selectedPort) { throw "No free port found near $preferredPort. Specify -$name explicitly." }
        Set-Variable -Name $name -Value $selectedPort
        $ports += $selectedPort
        Write-Host "$name $preferredPort is unavailable; using $selectedPort instead."
    }
    if ($Check) {
        Write-Host 'PASS: Python, Node.js, npm and service ports are ready. No installation or service start performed.'
        return
    }

    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    $requirements = Join-Path $root 'backend\requirements.txt'
    $requirementsHash = (Get-FileHash $requirements -Algorithm SHA256).Hash
    $requirementsStamp = Join-Path $root '.venv\htx-requirements.sha256'
    if (!(Test-Path $requirementsStamp) -or (Get-Content $requirementsStamp -Raw).Trim() -ne $requirementsHash) {
        Write-Host 'Installing backend dependencies ...'
        Invoke-Checked $python @('-m', 'pip', 'install', '-r', $requirements)
        Set-Content -Path $requirementsStamp -Value $requirementsHash -Encoding ASCII
    }

    $frontend = Join-Path $root 'frontend'
    $manifest = Join-Path $frontend 'package.json'
    $lockfile = Join-Path $frontend 'package-lock.json'
    $dependencyHash = (Get-FileHash $manifest -Algorithm SHA256).Hash
    if (Test-Path $lockfile) { $dependencyHash += (Get-FileHash $lockfile -Algorithm SHA256).Hash }
    $npmStamp = Join-Path $frontend 'node_modules\.htx-dependencies.sha256'
    if (!(Test-Path $npmStamp) -or (Get-Content $npmStamp -Raw).Trim() -ne $dependencyHash) {
        Push-Location $frontend
        try {
            Invoke-Checked $npm @('install', '--no-audit', '--no-fund')
        }
        finally { Pop-Location }
        $dependencyHash = (Get-FileHash $manifest -Algorithm SHA256).Hash
        if (Test-Path $lockfile) { $dependencyHash += (Get-FileHash $lockfile -Algorithm SHA256).Hash }
        Set-Content -Path $npmStamp -Value $dependencyHash -Encoding ASCII
    }

    $natsVersion = '2.12.1'
    $architecture = $env:PROCESSOR_ARCHITECTURE.ToLowerInvariant()
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432.ToLowerInvariant() }
    if ($architecture -notin @('amd64', 'arm64')) { throw "Unsupported Windows architecture: $architecture" }
    $natsName = "nats-server-v$natsVersion-windows-$architecture"
    $nats = Join-Path $runtime "$natsName\nats-server.exe"
    if (!(Test-Path $nats)) {
        Write-Host "Downloading NATS $natsVersion from the official release ..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $release = "https://github.com/nats-io/nats-server/releases/download/v$natsVersion"
        $archive = Join-Path $runtime "$natsName.zip"
        $checksums = Join-Path $runtime 'SHA256SUMS'
        Invoke-WebRequest -UseBasicParsing "$release/$natsName.zip" -OutFile $archive
        Invoke-WebRequest -UseBasicParsing "$release/SHA256SUMS" -OutFile $checksums
        $checksumLine = Get-Content $checksums | Where-Object { $_ -match "\s+\*?$([regex]::Escape($natsName)).zip$" }
        if (@($checksumLine).Count -ne 1) { throw 'NATS archive checksum missing or ambiguous.' }
        $expectedHash = ($checksumLine.Trim() -split '\s+')[0]
        if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expectedHash) { throw 'NATS archive checksum mismatch.' }
        Expand-Archive -Path $archive -DestinationPath $runtime -Force
        if (!(Test-Path $nats)) { throw 'NATS executable missing after extraction.' }
    }

    $frontendUrl = "http://127.0.0.1:$FrontendPort"
    $backendUrl = "http://127.0.0.1:$BackendPort"
    Set-LocalEnvironment 'NATS_URL' "nats://127.0.0.1:$NatsPort"
    Set-LocalEnvironment 'CORS_ORIGINS' "$frontendUrl,http://localhost:$FrontendPort"
    Set-LocalEnvironment 'AUTH_ENABLED' 'false'
    Set-LocalEnvironment 'VITE_API_URL' $backendUrl
    Set-LocalEnvironment 'VITE_OIDC_AUTHORITY' ''
    Set-LocalEnvironment 'VITE_OIDC_CLIENT_ID' ''
    Set-LocalEnvironment 'PYTHONUTF8' '1'

    $backendDirectory = Join-Path $root 'backend'
    if (!$UseLocalConfiguration) {
        $backendDirectory = Join-Path $runtime 'public\backend'
        New-Item -ItemType Directory -Force -Path $backendDirectory | Out-Null
        Copy-Item -Path (Join-Path $root 'backend\*.py') -Destination $backendDirectory -Force
        Copy-Item -Path (Join-Path $root 'backend\data') -Destination $backendDirectory -Recurse -Force
        foreach ($name in @('GITHUB_TOKEN', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_REPO', 'GITHUB_BASE_URL')) {
            Set-LocalEnvironment $name ''
        }
        Write-Host 'Public mode: isolated configuration and caches; existing private backend data is not loaded.'
    }

    $natsData = Join-Path $runtime 'nats-data'
    $natsProcess = Start-ServiceProcess 'nats' $nats @('-a', '127.0.0.1', '-p', "$NatsPort", '-m', "$MonitorPort", '-js', '-sd', "`"$natsData`"") $root
    Wait-Endpoint "http://127.0.0.1:$MonitorPort/healthz" $natsProcess
    $backendProcess = Start-ServiceProcess 'backend' $python @('-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', "$BackendPort") $backendDirectory
    Wait-Endpoint "$backendUrl/api/auth/status" $backendProcess
    $vite = Join-Path $frontend 'node_modules\vite\bin\vite.js'
    $frontendProcess = Start-ServiceProcess 'frontend' $node @("`"$vite`"", '--host', '127.0.0.1', '--port', "$FrontendPort", '--strictPort') $frontend
    Wait-Endpoint $frontendUrl $frontendProcess
    $css = Invoke-WebRequest -UseBasicParsing "$frontendUrl/src/index.css" -TimeoutSec 30
    if ($css.StatusCode -ne 200) { throw 'Frontend CSS compilation failed.' }
    $auth = Invoke-RestMethod "$backendUrl/api/auth/status" -TimeoutSec 10
    if ($auth.enabled -eq $true) { throw 'Native local mode must run without authentication.' }
    $cors = Invoke-WebRequest -UseBasicParsing "$backendUrl/api/auth/status" -Headers @{ Origin = $frontendUrl } -TimeoutSec 10
    if ($cors.Headers['Access-Control-Allow-Origin'] -ne $frontendUrl) { throw 'Frontend/backend CORS smoke test failed.' }
    Write-Host "PASS: NATS JetStream, backend, frontend CSS and CORS are ready."
    Write-Host "App: $frontendUrl   API docs: $backendUrl/docs"
    Write-Host "Logs and NATS data: $runtime"
    if ($UseLocalConfiguration) {
        Write-Host 'Local mode: authentication disabled. Existing local GitHub configuration is explicitly enabled.'
    }
    else {
        Write-Host 'Public mode: authentication disabled. Configure new data sources explicitly in Settings if needed.'
    }
    if (!$NoBrowser -and !$SmokeTest) { Start-Process $frontendUrl }
    if (!$SmokeTest) { Read-Host 'Press Enter to stop all three services. Keep this window open while using the app' | Out-Null }
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    foreach ($process in $children) {
        if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    }
    foreach ($name in $environmentBackup.Keys) {
        [Environment]::SetEnvironmentVariable($name, $environmentBackup[$name], 'Process')
    }
}