@echo off
echo =====================================================
echo  Starting ADS-MQTT Broker v4.0
echo =====================================================
echo.

REM Check if Redis is running
echo [1/2] Checking Redis connection...
redis-cli ping >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Redis is not running!
    echo.
    echo Please install and start Redis first:
    echo   1. Right-click install-redis.bat
    echo   2. Select "Run as Administrator"
    echo.
    echo Alternative: Start Redis manually:
    echo   redis-server
    echo.
    pause
    exit /b 1
)

echo [OK] Redis is running
echo.
echo [2/2] Starting Broker v4.0...
echo.
npm run dev:v4
