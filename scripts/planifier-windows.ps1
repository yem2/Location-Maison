# Crée une tâche Windows qui lance la sauvegarde des variables Vercel toutes les 15 minutes (même après redémarrage).
# Utilisation : clic droit > « Exécuter avec PowerShell », ou :  powershell -ExecutionPolicy Bypass -File scripts\planifier-windows.ps1
$script = Join-Path $PSScriptRoot "sync-env.mjs"
$node = (Get-Command node -ErrorAction Stop).Source
$action  = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "Sauvegarde variables Vercel" -Action $action -Trigger $trigger -Settings $settings -Description "Sauvegarde chiffrée des variables d'environnement Vercel" -Force | Out-Null
Write-Host "Tâche créée : « Sauvegarde variables Vercel » (toutes les 15 minutes). Pour l'arrêter : Unregister-ScheduledTask -TaskName 'Sauvegarde variables Vercel'"
