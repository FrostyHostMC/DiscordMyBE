@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Node.js 20 or newer is required. Detected:
  node --version
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing AutoPort dependencies...
  call npm install
  if errorlevel 1 (echo Dependency installation failed.& pause & exit /b 1)
)
where cmake >nul 2>nul
if not errorlevel 1 (
  if not exist "build\ragekit\Release\rk.exe" if not exist "build\ragekit\rk.exe" (
    echo.
    echo Preparing pinned RageKit native engine. First run downloads source via CMake FetchContent.
    cmake -S "native-engine" -B "build\ragekit" -DCMAKE_BUILD_TYPE=Release
    if not errorlevel 1 cmake --build "build\ragekit" --config Release --target rk
  )
)
for /r "build\ragekit" %%F in (rk.exe) do if exist "%%F" set "GTAV_AUTOPORT_RK=%%F"
if defined GTAV_AUTOPORT_RK (echo Native RageKit engine detected.) else (
  echo Native engine unavailable; intake and planning remain available.
  echo Install CMake 3.20+ and Visual Studio C++ Build Tools, then relaunch for native inspection.
)
echo Starting GTAV AutoPort. Keep this window open.
call npm run dev -- --host 127.0.0.1 --open
pause
