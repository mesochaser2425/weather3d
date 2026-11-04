@echo off
rem Uruchamia symulacje: instaluje zaleznosci (za pierwszym razem) i startuje serwer Vite.
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run dev
pause
