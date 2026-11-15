@echo off
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%build\ragekit" mkdir "%ROOT%build\ragekit"
cmake -S "%ROOT%native-engine" -B "%ROOT%build\ragekit" -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 goto failed
cmake --build "%ROOT%build\ragekit" --config Release --target rk
if errorlevel 1 goto failed
for /r "%ROOT%build\ragekit" %%F in (rk.exe) do (
  if exist "%%F" set "GTAV_AUTOPORT_RK=%%F"
)
if not defined GTAV_AUTOPORT_RK goto failed
echo ragekit engine built: %GTAV_AUTOPORT_RK%
echo.
echo Start AutoPort in this same terminal with:
echo   npm run dev
echo.
echo Set GTAV_AUTOPORT_RK permanently in Windows Environment Variables if you want auto-detection on later launches.
pause
exit /b 0
:failed
echo.
echo Native engine build failed. Check Git, CMake 3.20+, and Visual Studio C++ Build Tools.
pause
exit /b 1
