@echo off
setlocal
title HealthTrack-X
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-native.ps1" %*
if errorlevel 1 (
    echo.
    echo [FEHLER] HealthTrack-X konnte nicht gestartet werden. Details stehen oben.
    pause
    exit /b 1
)
exit /b 0