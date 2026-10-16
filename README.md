# Vibe Studio

Среда для вайб-кодинга: пишете ТЗ своими словами → студия подбирает архитектуру и команду
ИИ-агентов (архитектор, бэкенд, фронтенд, БД, DevOps, тестировщик) → вы жмёте «Запустить» →
агенты параллельно пишут код, а вы видите, кто что делает.

**API Claude не используется.** Студия запускает установленный у вас
[Claude Code](https://docs.claude.com/en/docs/claude-code) в headless-режиме (`claude -p`),
авторизация — через вашу подписку в самом CLI.

## Быстрый старт

Нужны Node.js 20.11+ (лучше 22), pnpm, git и Claude Code (`npm i -g @anthropic-ai/claude-code`,
затем один раз `claude` и войти).

```bash
pnpm install
pnpm studio          # http://localhost:4317, проекты — в ~/VibeProjects
```

Без Claude Code можно посмотреть интерфейс на демо-движке: выберите «Демо (без ИИ)» справа вверху.

Демо-версия одним HTML-файлом без сервера (агенты имитируются в браузере): `pnpm --filter @vibe/studio build:demo`.

### Через терминал

```bash
pnpm vibe engines                                  # какие движки доступны
pnpm vibe plan ~/VibeProjects/shop                 # ТЗ → вопросы → план (.vibe/plan.json)
pnpm vibe run  ~/VibeProjects/shop --concurrency 3 # запуск агентов
pnpm vibe status ~/VibeProjects/shop
```

Опции: `--engine claude-code|mock`, `--model sonnet|opus|haiku`, `--spec "…"`, `--spec-file`, `--no-clarify`, `--attempts N`.

## Как это работает

```
ТЗ ─► Планировщик (claude -p + JSON Schema) ─► план: стек, агенты, задачи с зависимостями
                                                  │  можно править в интерфейсе
                                                  ▼
      Оркестратор: задачи по графу, до N агентов одновременно
        для каждой задачи:
          1. git worktree + ветка vibe/<run>/<task>     ← агенты не мешают друг другу
          2. claude -p (роль, зона папок, контракты, задача), поток событий → дашборд
          3. коммит; checkCommand агента (тесты) → при ошибке повтор в той же сессии
          4. слияние свежего main в ветку; конфликт → агент сам его разрешает
          5. перемотка main, удаление worktree
```

- Первая задача — всегда у Архитектора: `docs/architecture.md` и `contracts/openapi.yaml`.
  Фронтенд и бэкенд потом работают параллельно по одному контракту.
- Упала задача — зависящие от неё блокируются, независимые продолжают работать.
- В проекте появляются `AGENTS.md` (общие правила и команда), `CLAUDE.md` (импортирует AGENTS.md)
  и `.vibe/` (`spec.md`, `plan.json`, `agents/*.md`; история запусков — в `.vibe/runs/`, вне git).
- Проект — обычный git-репозиторий: его можно открыть в VS Code в любой момент.

## Безопасность

- Агентам по умолчанию разрешены только правка файлов и типовые команды сборки/тестов
  (`npm`, `pnpm`, `node`, `python`, `pytest`, `go`, `cargo`, `git status/diff/log`…), см.
  `DEFAULT_ALLOWED_TOOLS` в `packages/core/src/orchestrator/orchestrator.ts`. Остальное CLI отклоняет.
- Галочка «Полный доступ к командам» включает `bypassPermissions` — только в контейнере/виртуалке.
- Сервер студии слушает только `127.0.0.1` и отклоняет запросы с чужих сайтов (проверка Host/Origin).

## Структура

```
packages/core/          ядро (без UI)
  src/plan/             схема плана (zod) и проверка: ссылки, циклы, порядок
  src/runners/          движки агентов: claude.ts (Claude Code), mock.ts (демо)
  src/planner/          уточняющие вопросы, генерация плана, промпты агентов
  src/orchestrator/     оркестратор и редьюсер состояния (общий с браузером)
  src/workspace/        git и worktree
  src/scaffold/         AGENTS.md, CLAUDE.md, папки агентов
apps/cli/               команда vibe
apps/studio/server/     локальный HTTP + SSE сервер
apps/studio/web/        интерфейс (React): ТЗ → команда и план → запуск → файлы
```

## Разработка

```bash
pnpm test         # vitest: ядро, движок Claude (на фейковом CLI), оркестратор на реальном git, сервер
pnpm typecheck
pnpm studio:dev   # сервер + Vite с горячей перезагрузкой
```

Новый движок (Codex CLI, Gemini CLI, Ollama…) — класс с интерфейсом `AgentRunner`
(`packages/core/src/runners/types.ts`), который превращает вывод CLI в `AgentEvent`.

## Известные ограничения

- Windows: Claude Code, установленный через npm, — это `claude.cmd`, а его Node не запускает
  без shell. Поставьте нативную версию (`claude.exe`) и при необходимости укажите путь к `claude.exe` в `VIBE_CLAUDE_BIN`.
- В каждом worktree зависимости (`node_modules`) ставятся заново — это медленнее, зато изолированно.
- Стоимость в дашборде — оценка CLI; при подписке тратятся лимиты подписки, а не деньги.
