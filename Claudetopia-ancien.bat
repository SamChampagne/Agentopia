@echo off
rem Lance l'ancienne interface de Claudetopia (Ink), en secours
set CLAUDETOPIA_INK=1
node "%~dp0dist\index.js" %*
