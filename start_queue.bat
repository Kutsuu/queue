@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 goto use_py_launcher

where python >nul 2>nul
if not errorlevel 1 goto use_python

echo Python 3 is not installed or not available in PATH.
echo Install Python 3, then run this file again.
goto finish

:use_py_launcher
py -3 run_local.py %*
goto finish

:use_python
python run_local.py %*

:finish
echo.
pause
