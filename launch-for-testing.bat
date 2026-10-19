@echo off
title MAT LEADS - Launch for Testing
cd /d e:\jjjjjj
echo === MAT LEADS AI PRO X - Test Launcher ===
echo Killing old server (if any)...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
echo Starting server...
mkdir logs 2>nul
start "MAT-LEADS-SERVER" /min cmd /c "node api/server.js ^> logs\server.log 2^>^&1"
echo Waiting for server to boot...
timeout /t 4 /nobreak >nul
echo Checking health...
curl -s http://localhost:3000/api/health
echo.
echo Opening browser tabs...
start http://localhost:3000/index.html
timeout /t 1 /nobreak >nul
start http://localhost:3000/signup.html
timeout /t 1 /nobreak >nul
start http://localhost:3000/login.html
timeout /t 1 /nobreak >nul
start http://localhost:3000/dashboard.html
echo.
echo === SERVER LOG (last lines) ===
type logs\server.log
echo.
echo Done. Keep this window open. Press any key to view log again.
pause >nul
type logs\server.log
pause
