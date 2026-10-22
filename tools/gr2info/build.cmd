@echo off
rem Builds gr2info.exe (x86) against the client's granny24.lib. Run from any folder.
setlocal
set CLIENT=%~dp0..\..\..\apix-client
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars32.bat" >nul || exit /b 1
cd /d "%~dp0"
cl /nologo /O2 /EHsc /MD /I "%CLIENT%\extern\include\granny" gr2info.cpp "%CLIENT%\extern\lib\granny24.lib" /Fe:gr2info.exe || exit /b 1
del /q gr2info.obj 2>nul
