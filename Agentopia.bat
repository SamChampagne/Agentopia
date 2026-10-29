@echo off
rem Lance Agentopia avec les reglages et sessions existants
title Agentopia
node "%~dp0dist\index.js" %*
