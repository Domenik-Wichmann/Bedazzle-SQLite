@echo off
echo Starting Bedazzle from "%~dp0"
setlocal
cd /d "%~dp0"
set "BEDAZZLE_ROOT=%~dp0"
if not exist "%~dp0runtime\python\python.exe" (
  echo First-time setup: downloading portable Python. Nothing is installed system-wide.
  powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $dir=Join-Path $env:BEDAZZLE_ROOT 'runtime\python'; New-Item -ItemType Directory -Force $dir | Out-Null; $zip=Join-Path $env:BEDAZZLE_ROOT 'runtime\python-runtime.zip'; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip' -OutFile $zip; if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159') { throw 'Python download checksum did not match. Please retry.' }; Expand-Archive -LiteralPath $zip -DestinationPath $dir -Force"
  if errorlevel 1 goto failed
)
"%~dp0runtime\python\python.exe" "%~dp0bootstrap.py"
if errorlevel 1 goto failed
"%~dp0runtime\python\python.exe" "%~dp0workbench.py" %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Bedazzle could not start. Read the message above. Extract the whole ZIP into a writable folder first.
pause
exit /b 1
