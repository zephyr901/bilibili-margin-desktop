@echo off
setlocal
if not defined LOCALAPPDATA goto missing
set "MARGIN_DESKTOP_ROOT=%LOCALAPPDATA%\MARGIN-Bilibili\DesktopProfile"
pushd "%~dp0client" || goto missing
if not exist "resources\app.asar" goto incomplete
set "MARGIN_APP_EXE="
for %%F in (*.exe) do if not defined MARGIN_APP_EXE if exist "%%F" set "MARGIN_APP_EXE=%%~fF"
if not defined MARGIN_APP_EXE goto incomplete
start "" "%MARGIN_APP_EXE%" --margin-desktop
set "MARGIN_START_RESULT=%ERRORLEVEL%"
popd
exit /b %MARGIN_START_RESULT%
:incomplete
popd
:missing
echo Unable to start MARGIN. Extract the entire ZIP to a writable local folder, then run this launcher.
pause
exit /b 1
