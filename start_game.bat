@echo off
:: Start Yumeiro Patissiere fan game via local http server
:: (image assets require http:// access; file:// would fall back to canvas placeholders)

:: Skip server start if port 8765 is already in use
netstat -ano | findstr :8765 | findstr LISTENING >nul
if %errorlevel%==0 (
  echo Server already running on port 8765.
) else (
  echo Starting local server on port 8765 ...
  start "" python -m http.server 8765 -d "D:\workdir\SynologyDrive\prog_main\python\game_cake"
  timeout /t 2 >nul
)

:: Open the game in default browser
start "" "http://127.0.0.1:8765/yumeiro_game/index.html"
