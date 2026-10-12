<#
.SYNOPSIS
  One-time setup for the Packrat SD launcher: writes sd_launcher.json with a
  freshly generated token (if it doesn't exist yet), adds a shortcut to your
  Startup folder so the launcher starts at log on, starts it now, and prints
  the lines to paste into Packrat's environment.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1 -StartCommand "C:\stable-diffusion-webui\webui-user.bat"

.NOTES
  Re-running is safe: an existing sd_launcher.json (and its token) is kept,
  and a running launcher is restarted so config changes apply.
  Run -Uninstall to stop the launcher and remove the shortcut.

  Why a Startup shortcut and not Task Scheduler: Stable Diffusion started from
  a Task Scheduler task failed with "Torch is not able to use GPU", while the
  same launcher started normally worked. Startup-folder items are launched by
  Explorer like anything you double-click, so SD gets the same environment as
  when you run its .bat by hand.
#>
param(
    [string]$StartCommand,
    [int]$Port = 7870,
    [string]$SdUrl = "http://127.0.0.1:7860",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$Name = "Packrat SD Launcher"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Here "sd_launcher.json"
$Script = Join-Path $Here "sd_launcher.py"
$Shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "$Name.lnk"

function Stop-Launcher {
    Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
        Where-Object { $_.CommandLine -like "*sd_launcher.py*" } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped running launcher (pid $($_.ProcessId))."
        }
}

# Earlier versions of this script registered a scheduled task instead.
function Remove-OldTask {
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
        Write-Host "Removed old scheduled task '$Name'."
    }
}

if ($Uninstall) {
    Stop-Launcher
    Remove-OldTask
    if (Test-Path $Shortcut) { Remove-Item $Shortcut; Write-Host "Removed $Shortcut" }
    Write-Host "Done. sd_launcher.json was left in place."
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

Remove-OldTask
Stop-Launcher

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($Shortcut)
$lnk.TargetPath = $Pythonw
$lnk.Arguments = "`"$Script`""
$lnk.WorkingDirectory = $Here
$lnk.Description = "Starts/stops Stable Diffusion for Packrat"
$lnk.Save()
Write-Host "Created $Shortcut (runs at log on)."

# Launch through Explorer, exactly as at log on — and un-elevated even if this
# PowerShell window is running as administrator.
Start-Process explorer.exe -ArgumentList "`"$Shortcut`""
Start-Sleep -Seconds 2
if (Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe'" | Where-Object { $_.CommandLine -like "*sd_launcher.py*" }) {
    Write-Host "Launcher is running."
} else {
    Write-Warning "Launcher didn't start - check $(Join-Path $Here 'sd_launcher.log'), or run 'python .\sd_launcher.py' to see the error."
}

Write-Host ""
Write-Host "Add these under 'environment:' in docker-compose.yml (as '- KEY=value'), then recreate the container."
Write-Host "(Or put them in docker/.env AND add 'env_file: [.env]' to the packrat service - a .env alone isn't passed in.)"
Write-Host ""
Write-Host "  PACKRAT_ACTION_1_LABEL=Start Stable Diffusion"
Write-Host "  PACKRAT_ACTION_1_URL=http://host.docker.internal:$($cfg.port)/start"
Write-Host "  PACKRAT_ACTION_1_TOKEN=$($cfg.token)"
Write-Host "  PACKRAT_ACTION_2_LABEL=Stop Stable Diffusion"
Write-Host "  PACKRAT_ACTION_2_URL=http://host.docker.internal:$($cfg.port)/stop"
Write-Host "  PACKRAT_ACTION_2_TOKEN=$($cfg.token)"
Write-Host ""
