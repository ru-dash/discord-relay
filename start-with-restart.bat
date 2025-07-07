@echo off
REM Auto-restart wrapper for Discord Relay Bot instances
REM Usage: start-with-restart.bat <config-file>

if "%~1"=="" (
    echo Usage: start-with-restart.bat ^<config-file^>
    echo Example: start-with-restart.bat configs\example-bot.json
    pause
    exit /b 1
)

set CONFIG_FILE=%~1

if not exist "%CONFIG_FILE%" (
    echo Error: Config file not found: %CONFIG_FILE%
    pause
    exit /b 1
)

echo Starting Discord Relay Bot with auto-restart enabled...
echo Config: %CONFIG_FILE%
echo.
echo Press Ctrl+C to stop the bot (will stop auto-restart)
echo.

REM Start the process manager
node process-management\process-manager.js "%CONFIG_FILE%"

pause
