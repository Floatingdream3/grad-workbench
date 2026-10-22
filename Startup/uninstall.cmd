@echo off
py -3 "%~dp0..\keepalive.py" uninstall-startup %*
exit /b %errorlevel%
