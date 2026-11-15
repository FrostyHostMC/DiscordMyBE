@echo off
setlocal
cd /d "%~dp0"
where powershell >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell is required to open the file pickers.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\inspect-resource-pair.ps1"
if errorlevel 1 pause
