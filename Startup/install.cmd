@echo off
py -3 "%~dp0..\keepalive.py" install-startup %*
exit /b %errorlevel%
