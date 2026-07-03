# Runs backend and frontend dev servers concurrently in separate jobs.
# Stop with Ctrl+C, then: Get-Job | Stop-Job; Get-Job | Remove-Job
$root = Split-Path -Parent $PSScriptRoot

$backend = Start-Job -ScriptBlock {
    Set-Location "$using:root/backend"
    go run ./cmd/server
}

$frontend = Start-Job -ScriptBlock {
    Set-Location "$using:root/frontend"
    npm run dev
}

Write-Host "Backend job: $($backend.Id)  Frontend job: $($frontend.Id)"
Write-Host "Streaming output (Ctrl+C to stop watching; jobs keep running until you Stop-Job them)..."
Receive-Job -Job $backend, $frontend -Wait
