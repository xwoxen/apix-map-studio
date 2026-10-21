@echo off
rem Starts APIX Map Studio. Models and textures come from apix-client\bin\pack (no D: drive needed).
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
