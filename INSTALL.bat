@echo off
setlocal
TITLE HealthTrack-X Container/K8s Check

echo ========================================
echo   HealthTrack-X Container/K8s Check
echo ========================================
echo.
echo This repository now runs through containers and Kubernetes.
echo Canonical local development: Rancher Desktop/K3s with k8s\overlays\local.
echo Docker Compose is supplementary for targeted service checks.
echo This script validates the required local tooling; it no longer installs
echo Python virtualenvs, npm packages, NATS binaries, or local service runners.
echo.

SET "SCRIPT_DIR=%~dp0"
SET "FAILED="
cd /d "%SCRIPT_DIR%"

call :check_file "docker-compose.yml" "Docker Compose stack"
call :check_file "k8s\base\kustomization.yaml" "Kubernetes base manifests"
call :check_file "k8s\overlays\local\kustomization.yaml" "Local Kubernetes overlay"
call :check_file "k8s\overlays\local-ollama\kustomization.yaml" "Optional native-Ollama overlay"
call :check_file ".env.example" "Environment template"

where docker >nul 2>&1
if errorlevel 1 (
    where nerdctl >nul 2>&1
    if errorlevel 1 (
        echo [X] Container runtime CLI not found ^(Docker or nerdctl^)
        SET "FAILED=1"
    ) else (
        echo [OK] nerdctl found
    )
) else (
    echo [OK] Docker found
)

where kubectl >nul 2>&1
if errorlevel 1 (
    echo [X] kubectl not found
    SET "FAILED=1"
) else (
    echo [OK] kubectl found
    kubectl kustomize "k8s\overlays\local" >nul 2>&1
    if errorlevel 1 (
        echo [X] Local Kustomize overlay does not render
        SET "FAILED=1"
    ) else (
        echo [OK] Local Kustomize overlay renders
    )
    kubectl kustomize "k8s\overlays\local-ollama" >nul 2>&1
    if errorlevel 1 (
        echo [X] Local Ollama Kustomize overlay does not render
        SET "FAILED=1"
    ) else (
        echo [OK] Local Ollama Kustomize overlay renders
    )
)

where az >nul 2>&1
if errorlevel 1 (
    echo [i] Azure CLI not found ^(only needed for AKS/ACR work^)
) else (
    echo [OK] Azure CLI found
)

if not exist ".env" (
    echo [i] .env not found. Copy .env.example to .env when using docker compose locally.
)

echo.
if defined FAILED (
    echo Environment check failed. Install the missing tooling above.
    exit /b 1
)

echo Environment check passed.
exit /b 0

:check_file
if exist "%~1" (
    echo [OK] %~2
) else (
    echo [X] Missing %~2 ^(%~1^)
    SET "FAILED=1"
)
exit /b 0