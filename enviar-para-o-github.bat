@echo off
title Enviando Mascara3D para o GitHub
cd /d "C:\Users\Lucas\.gemini\antigravity\scratch\mascara-3d-landing-page"
echo ========================================================
echo   Preparando arquivos da loja Mascara3D...
echo ========================================================
"C:\Users\Lucas\.gemini\antigravity\scratch\mingit\cmd\git.exe" add .
"C:\Users\Lucas\.gemini\antigravity\scratch\mingit\cmd\git.exe" commit -m "Upload completo da loja Mascara3D"
echo ========================================================
echo   Enviando para https://github.com/lucasferreira1999-bit/3dmascara ...
echo ========================================================
"C:\Users\Lucas\.gemini\antigravity\scratch\mingit\cmd\git.exe" push -u origin main
echo.
echo ========================================================
echo   Finalizado! Pressione qualquer tecla para fechar.
echo ========================================================
pause
