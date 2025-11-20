@echo off
echo =====================================================
echo  Redis Installation for ADS-MQTT Broker v4.0
echo =====================================================
echo.

REM Check for admin rights
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Running with Administrator privileges
) else (
    echo [ERROR] This script requires Administrator privileges
    echo Please right-click and select "Run as Administrator"
    pause
    exit /b 1
)

echo.
echo [1/3] Installing Redis via Chocolatey...
choco install redis-64 -y

if %errorLevel% neq 0 (
    echo.
    echo [ERROR] Redis installation failed!
    echo.
    echo Alternative: Install Memurai (Redis for Windows)
    echo Download: https://www.memurai.com/get-memurai
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] Installing Redis as Windows Service...
redis-server --service-install

echo.
echo [3/3] Starting Redis Service...
redis-server --service-start

echo.
echo =====================================================
echo  Redis Installation Complete!
echo =====================================================
echo.
echo Redis is now running on localhost:6379
echo.
echo Next step: Start the broker
echo   npm run dev:v4
echo.
echo Press any key to close...
pause >nul
