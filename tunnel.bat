1@echo off
title CLOUDFLARED TUNNEL
cd /d "%~dp0"
cloudflared.exe tunnel --url http://localhost:3000
pause