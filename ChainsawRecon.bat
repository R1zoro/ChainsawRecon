@echo off
cd /d "%~dp0"
uv run chainsaw-recon
if errorlevel 1 pause
