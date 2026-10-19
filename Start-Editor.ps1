param(
    [string] $Client = '',
    [int] $Port = 5189,
    [switch] $NoBrowser,
    [string] $WebOrigin = ''
)
$ErrorActionPreference = 'Stop'
$address = "http://127.0.0.1:$Port"
$running = $false
try {
    $info = Invoke-RestMethod "$address/api/catalog" -TimeoutSec 2
    $running = $null -ne $info.files
} catch {}
if (-not $running) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $logs = Join-Path $PSScriptRoot '.run'
    New-Item -ItemType Directory -Force $logs | Out-Null
    $server = Join-Path $PSScriptRoot 'server.mjs'
    $editorArguments = @("`"$server`"", '--port', "$Port")
    if ($Client) { $editorArguments += @('--client', "`"$Client`"") }
    if ($WebOrigin) { $editorArguments += @('--web-origin', "`"$WebOrigin`"") }
    $editorProcess = Start-Process $node -ArgumentList $editorArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\stdout.log" -RedirectStandardError "$logs\stderr.log"
    $editorProcess.Id | Set-Content "$logs\server.pid"
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $info = Invoke-RestMethod "$address/api/catalog" -TimeoutSec 2
            if ($null -ne $info.files) { $running = $true; break }
        } catch {}
        if ($editorProcess.HasExited) { throw (Get-Content "$logs\stderr.log" -Raw) }
    }
}
if (-not $running) { throw 'The interface editor did not start' }
if ($Client -and $info.client -ne $Client) {
    $selectionBody = @{ path = $Client } | ConvertTo-Json -Compress
    Invoke-RestMethod "$address/api/client" -Method Post -ContentType 'application/json' -Body $selectionBody | Out-Null
    $info = Invoke-RestMethod "$address/api/catalog"
}
Write-Output $address
Write-Output $info.client
if ($WebOrigin -and $info.webOrigins -notcontains $WebOrigin.TrimEnd('/')) {
    $originBody = @{ origin = $WebOrigin } | ConvertTo-Json -Compress
    Invoke-RestMethod "$address/api/web-origin" -Method Post -ContentType 'application/json' -Body $originBody | Out-Null
}
if (-not $NoBrowser) { Start-Process $address }
