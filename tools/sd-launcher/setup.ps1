<#
.SYNOPSIS
  One-time setup for the Packrat SD launcher: writes sd_launcher.json with a
  freshly generated token (if it doesn't exist yet), registers a Task
  Scheduler task that starts the launcher at log on, and prints the lines to
  paste into Packrat's environment.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1 -StartCommand "C:\stable-diffusion-webui\webui-user.bat"

.NOTES
  Re-running is safe: an existing sd_launcher.json (and its token) is kept,
  and the scheduled task is replaced. Run -Uninstall to remove the task.
#>
param(
    [string]$StartCommand,
    [int]$Port = 7870,
    [string]$SdUrl = "http://127.0.0.1:7860",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "Packrat SD Launcher"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Here "sd_launcher.json"
$Script = Join-Path $Here "sd_launcher.py"

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$TaskName'. sd_launcher.json was left in place."
    exit 0
}

# pythonw.exe runs without a console window of its own.
$Pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $Pythonw) {
    throw "pythonw.exe not found on PATH. Install Python 3 from python.org (tick 'Add python.exe to PATH') and re-run."
}

if (Test-Path $ConfigPath) {
    Write-Host "Keeping existing $ConfigPath"
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
} else {
    if (-not $StartCommand) { throw "-StartCommand is required on first run (path to your webui-user.bat)." }
    if (-not (Test-Path $StartCommand -PathType Leaf)) { throw "StartCommand '$StartCommand' does not exist." }

    # 32 random bytes from the OS CSPRNG, URL-safe base64 -> 43 characters.
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

    $cfg = [ordered]@{
        token         = $token
        bind          = "127.0.0.1"
        port          = $Port
        start_command = (Resolve-Path $StartCommand).Path
        sd_url        = $SdUrl
        show_console  = $true
    }
    $json = $cfg | ConvertTo-Json
    [System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding $false))
    $cfg = $json | ConvertFrom-Json
    Write-Host "Wrote $ConfigPath"
}

# At log on, in your own session (needed for GPU/desktop access), restart on crash.
$action = New-ScheduledTaskAction -Execute $Pythonw -Argument "`"$Script`"" -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Registered and started scheduled task '$TaskName'."

Write-Host ""
Write-Host "Add these to Packrat's environment (docker-compose.yml 'environment:' or .env), then recreate the container:"
Write-Host ""
Write-Host "  PACKRAT_ACTION_1_LABEL=Start Stable Diffusion"
Write-Host "  PACKRAT_ACTION_1_URL=http://host.docker.internal:$($cfg.port)/start"
Write-Host "  PACKRAT_ACTION_1_TOKEN=$($cfg.token)"
Write-Host "  PACKRAT_ACTION_2_LABEL=Stop Stable Diffusion"
Write-Host "  PACKRAT_ACTION_2_URL=http://host.docker.internal:$($cfg.port)/stop"
Write-Host "  PACKRAT_ACTION_2_TOKEN=$($cfg.token)"
Write-Host ""
