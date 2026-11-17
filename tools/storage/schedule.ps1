<#
.SYNOPSIS
  Registers a daily Windows Task Scheduler job: back up production to this PC,
  then archive its detailed Auction House history.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\storage\schedule.ps1 -SshTarget srv-XXXX@ssh.ohio.render.com

.NOTES
  Runs as the current user, only when that user is logged on (the SSH key in
  ~/.ssh and its agent are that user's). Output goes to <Root>\logs\.
  Remove with: Unregister-ScheduledTask -TaskName "Guildweaver backup" -Confirm:$false
#>
param(
  [Parameter(Mandatory = $true)][string]$SshTarget,
  [string]$Root = "",
  [string]$At = "04:30",
  [int]$Keep = 30,
  [string]$Node = (Get-Command node -ErrorAction Stop).Source,
  [string]$TaskName = "Guildweaver backup"
)

$ErrorActionPreference = "Stop"
$tools = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = if (Test-Path "D:\") { "D:\GuildweaverData" } else { Join-Path $HOME "GuildweaverData" } }
New-Item -ItemType Directory -Force (Join-Path $Root "logs") | Out-Null

# One script per run: backup, then archive; each run's output in its own log.
$runner = Join-Path $Root "run-backup.ps1"
@"
`$ErrorActionPreference = "Continue"
`$log = Join-Path "$Root\logs" ("backup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
& "$Node" "$tools\backup.mjs" --ssh "$SshTarget" --root "$Root" --keep $Keep *>> `$log
if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }
& "$Node" "$tools\archive.mjs" export --root "$Root" *>> `$log
exit `$LASTEXITCODE
"@ | Set-Content -Encoding UTF8 $runner

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Guildweaver: production backup and Auction House archive to $Root" -Force | Out-Null
Write-Output "Registered '$TaskName' daily at $At. Runner: $runner. Logs: $Root\logs"
