@echo off
cd /d e:/jjjjjj
mkdir logs 2>nul
start /B node api/server.js > logs\server.log 2>&1
echo Server started in background (pid echoed above)
