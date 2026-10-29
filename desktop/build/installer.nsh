; Keep the stock NSIS installer, replacing its force-stop behavior with a guard.
!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\pdfpal-installer-guard.ps1 "${BUILD_RESOURCES_DIR}\installer-guard.ps1"
  pdfpal_check_running:
    nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\pdfpal-installer-guard.ps1" -InstallDirectory "$INSTDIR" -Executable "${APP_EXECUTABLE_FILENAME}" -AppId "${APP_ID}"'
    Pop $R0
    Pop $R1
    StrCmp $R0 "0" pdfpal_not_running
    IfSilent pdfpal_install_blocked
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Quit pdfpal from its tray menu before continuing. Save your work and finish or cancel any running answer, then choose Retry. If pdfpal is already closed, Windows could not verify its status; try again.$\r$\n$\r$\nCancel leaves your current application and library in place." IDRETRY pdfpal_check_running
  pdfpal_install_blocked:
    SetErrorLevel 1618
    Quit
  pdfpal_not_running:
!macroend

!macro customUnInstall
  ; An upgrade keeps the existing Windows-startup preference at the same path.
  ${ifNot} ${isUpdated}
    InitPluginsDir
    File /oname=$PLUGINSDIR\pdfpal-installer-guard.ps1 "${BUILD_RESOURCES_DIR}\installer-guard.ps1"
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\pdfpal-installer-guard.ps1" -InstallDirectory "$INSTDIR" -Executable "${APP_EXECUTABLE_FILENAME}" -AppId "${APP_ID}" -RemoveStartup'
    Pop $R0
    Pop $R1
    StrCmp $R0 "0" +3
      SetErrorLevel 3
      Abort "Windows startup registration could not be removed. Retry uninstall."
  ${endIf}
!macroend
