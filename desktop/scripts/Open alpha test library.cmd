@echo off
setlocal
set "PDFPAL_APP=%LOCALAPPDATA%\Programs\pdfpal\pdfpal.exe"
if not exist "%PDFPAL_APP%" (
  echo Install pdfpal with the supplied installer first.
  pause
  exit /b 1
)
set "PDFPAL_DATA_DIR=%LOCALAPPDATA%\pdfpal-m0-test"
set "PDFPAL_DB=%PDFPAL_DATA_DIR%\pdfpal.db"
set "PDFPAL_PORT=8210"
set "PDFPAL_AGENT="
set "PDFPAL_M0_LIVE=0"
set "PDFPAL_M1_LIVE_CODEX=0"
set "PDFPAL_DESKTOP_PROFILE="
start "" "%PDFPAL_APP%"
endlocal
