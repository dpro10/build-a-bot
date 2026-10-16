; Build-a-bot's additions to electron-builder's Windows installer (picked up from build/ by name).

; Uninstalling, not updating. Before the app's data folder is deleted: Private speech's engine
; (NVIDIA's nemo-speech.exe, which runs from that folder) may still be running if the app was
; closed without stopping it, and Windows won't delete files a running program has open. Then the
; "Start at login" entry, if it was on (Electron names it after the app's ID).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | ? { $$_.Name -eq 'nemo-speech.exe' -and $$_.ExecutablePath -like '*\speech\runtime\bin\nemo-speech.exe' -and $$_.CommandLine -like '*parakeet-tdt-0.6b-v3*' } | % { Stop-Process -Id $$_.ProcessId -Force }"`
    Pop $0
    Pop $0
    Sleep 500
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "site.build-a-bot.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "site.build-a-bot.desktop"
  ${endIf}
!macroend
