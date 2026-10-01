@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or later, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
if not exist dist\index.html (
  call npm run build
  if errorlevel 1 exit /b 1
)
echo.
echo Zupestore is starting.
echo Open http://127.0.0.1:3001 in your browser.
echo Keep this window open while using the application.
echo Press Ctrl+C to stop.
echo.
call npm start
