@echo off
setlocal
title HealthTrack-X starten

cd /d "%~dp0"
echo ========================================
echo   HealthTrack-X lokal starten
echo ========================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Docker wurde nicht gefunden.
    echo Bitte Rancher Desktop installieren und starten.
    pause
    exit /b 1
)

where kubectl >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] kubectl wurde nicht gefunden.
    echo Bitte Rancher Desktop mit aktiviertem Kubernetes starten.
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Die Docker-Engine ist nicht erreichbar.
    echo Bitte Rancher Desktop starten und als Container Engine dockerd ^(moby^) auswaehlen.
    pause
    exit /b 1
)

kubectl get nodes >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Das lokale Kubernetes ist nicht erreichbar.
    echo Bitte in Rancher Desktop Kubernetes ^(K3s^) aktivieren und kurz warten.
    pause
    exit /b 1
)

echo [1/3] Backend-Image wird gebaut ...
docker build -t htx-backend:local -f backend\Dockerfile .
if errorlevel 1 goto :failed

echo [2/3] Frontend-Image wird gebaut ...
docker build -t htx-frontend:local -f frontend\Dockerfile .
if errorlevel 1 goto :failed

echo [3/3] Anwendung wird gestartet ...
kubectl apply -k k8s\overlays\local
if errorlevel 1 goto :failed

echo Starte die neu gebauten Images ...
kubectl rollout restart deployment/htx-backend deployment/htx-frontend -n healthtrack-x
if errorlevel 1 goto :failed

echo Warte auf die Anwendung ...
kubectl rollout status deployment/htx-backend -n healthtrack-x --timeout=180s
if errorlevel 1 goto :failed
kubectl rollout status deployment/htx-frontend -n healthtrack-x --timeout=180s
if errorlevel 1 goto :failed

echo.
echo HealthTrack-X ist bereit: http://htx.local
start "" "http://htx.local"
pause
exit /b 0

:failed
echo.
echo [FEHLER] Der Start ist fehlgeschlagen.
echo Details stehen oben im Fenster. Fuer Hilfe bitte dieses Fenster offen lassen.
pause
exit /b 1