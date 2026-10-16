@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Vibe Studio

echo.
echo  === Vibe Studio ===
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node
where git >nul 2>nul
if errorlevel 1 goto no_git

where claude >nul 2>nul
if errorlevel 1 (
  echo  [!] Claude Code не найден. Студия откроется, но настоящие агенты работать не будут.
  echo      Установка: откройте PowerShell и выполните  irm https://claude.ai/install.ps1 ^| iex
  echo.
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo  Устанавливаю pnpm...
  call npm install -g pnpm
  if errorlevel 1 goto failed
)

if not exist node_modules (
  echo  Первый запуск: устанавливаю зависимости, это займёт 1-3 минуты...
  call pnpm install
  if errorlevel 1 goto failed
)

echo  Собираю интерфейс...
call pnpm --filter @vibe/studio build
if errorlevel 1 goto failed

echo.
echo  Сейчас откроется браузер. Если нет - откройте адрес http://localhost:4317
echo.
call pnpm exec tsx apps/studio/server/index.ts --open
pause
exit /b 0

:no_node
echo  [!] Не найден Node.js.
echo      Скачайте его с https://nodejs.org - зелёная кнопка LTS - и установите.
echo      Потом запустите этот файл снова.
pause
exit /b 1

:no_git
echo  [!] Не найден Git.
echo      Скачайте его с https://git-scm.com/download/win и установите, везде нажимая Next.
echo      Потом запустите этот файл снова.
pause
exit /b 1

:failed
echo.
echo  [!] Что-то пошло не так. Скопируйте текст ошибки выше и пришлите его в чат.
pause
exit /b 1
