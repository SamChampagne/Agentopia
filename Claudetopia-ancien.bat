@echo off
title Agentopia
rem Lance l'ancienne interface de Agentopia (Ink), en secours
set CLAUDETOPIA_INK=1
node "%~dp0dist\index.js" %*
