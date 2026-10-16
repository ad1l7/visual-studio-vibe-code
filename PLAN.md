# План: IDE для вайб-кодеров (рабочее название — VibeStudio)

## 1. Идея в одном абзаце

Десктоп-приложение, где пользователь пишет ТЗ своими словами → система сама предлагает
архитектуру (фронт / бэк / БД / DevOps / тесты) и команду агентов под неё → пользователь
правит план и жмёт «Запуск» → агенты параллельно пишут код, а пользователь видит на дашборде,
кто что делает, какие файлы меняет, что готово, что сломалось.

Ключевое решение: **не вызывать API Claude напрямую**, а запускать установленные у пользователя
CLI-агенты (Claude Code, Codex CLI, Gemini CLI и т.д.) как дочерние процессы в headless-режиме.
Авторизация — через подписку пользователя в самом CLI. Ваше приложение — оркестратор и UI.

## Статус (октябрь 2026)

- ✅ **Этап 0 — ядро**: адаптер Claude Code (`claude -p`, stream-json), планировщик с уточняющими
  вопросами и JSON Schema, оркестратор по графу с параллелизмом, git worktree на задачу,
  повторы, `checkCommand`, разрешение конфликтов агентом, CLI `vibe`. Проверено на реальном Claude Code.
- ✅ **Этап 1 — MVP интерфейса**: экраны ТЗ → команда и план (редактирование агентов и задач,
  этапы) → запуск (карточки агентов, канбан, лента событий, отчёты) → файлы проекта.
  Сделан как локальный веб-сервер + React вместо Electron: тот же React-код позже
  оборачивается в Electron без переписывания.
- ⏭ **Дальше**: Electron-оболочка, diff-просмотр (Monaco), встроенный терминал, превью
  запущенного приложения, SQLite вместо JSON-файлов, движки Codex/Gemini/Ollama, Docker-песочница.

Как запустить — в [README.md](README.md).

---

## 2. Архитектура

```
┌──────────────────────── Electron (UI, React) ────────────────────────┐
│  ТЗ-ввод │ План/граф агентов │ Дашборд запуска │ Дерево файлов │ Превью│
└───────────────▲──────────────────────────────────────────────────────┘
                │ IPC (типизированный, напр. tRPC-electron / electron-trpc)
┌───────────────┴──────────── Main process (Node.js) ──────────────────┐
│  Planner        — превращает ТЗ в JSON-план (агенты + задачи + DAG)  │
│  Scaffolder     — создаёт папки, AGENTS.md/CLAUDE.md, git-репо       │
│  Orchestrator   — очередь задач по DAG, параллельный запуск          │
│  Agent Runner   — адаптеры CLI: claude / codex / gemini / ollama     │
│  Workspace Mgr  — git worktree на каждого агента, merge, конфликты   │
│  Event Bus      — стрим событий агентов → UI + запись в БД           │
│  Storage        — SQLite (проекты, задачи, события, стоимость)       │
└──────────────────────────────────────────────────────────────────────┘
                │ spawn (node-pty / child_process)
        claude -p … --output-format stream-json   (в worktree агента)
        codex exec --json …
```

### Почему так
- **Electron**, а не веб: нужен доступ к файловой системе, git, запуску процессов и терминалу.
  VS Code сам на Electron, поэтому все нужные компоненты существуют (xterm.js, Monaco, node-pty).
  Tauri легче по весу, но процессы/PTY и экосистема на Rust сложнее для старта.
- **Каждый агент = отдельный CLI-процесс** (а не встроенные субагенты Claude Code): так вы
  получаете полную видимость статуса, логов, стоимости и можете остановить/перезапустить
  конкретного агента.
- **Каждый агент в своём git worktree и ветке**: агенты не затирают файлы друг друга,
  результат вливается в `main` после проверок.

---

## 3. Стек

| Слой | Технология |
|---|---|
| Оболочка | Electron + electron-vite |
| UI | React + TypeScript, Tailwind + shadcn/ui, Zustand |
| Граф агентов | React Flow (@xyflow/react) |
| Логи/терминал | xterm.js + node-pty |
| Просмотр кода / diff | Monaco Editor (DiffEditor) |
| Дерево файлов | chokidar (watcher) + собственный компонент |
| БД | SQLite: better-sqlite3 + Drizzle ORM |
| Git | simple-git (worktree, branch, merge) |
| Валидация планов | zod (+ JSON Schema для промпта) |
| Превью приложения | `<webview>`/iframe на `localhost:<port>` |
| Изоляция (опционально) | Docker / devcontainer для запуска агентов |

---

## 4. Как работает без API Claude

### 4.1 Адаптер агента (единый интерфейс)
```ts
interface AgentRunner {
  id: 'claude-code' | 'codex' | 'gemini' | 'ollama';
  isInstalled(): Promise<boolean>;      // `which claude`, `claude --version`
  isAuthorized(): Promise<boolean>;
  run(opts: {
    cwd: string;                        // worktree агента
    prompt: string;
    systemPrompt?: string;
    allowedTools?: string[];
    resumeSessionId?: string;
    jsonSchema?: object;                // для Planner
  }): AsyncIterable<AgentEvent>;        // text | tool_use | file_change | result | error
  stop(): void;
}
```

### 4.2 Claude Code (основной)
```bash
claude -p "<промпт задачи>" \
  --output-format stream-json --verbose \
  --append-system-prompt "<роль агента>" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Bash(npm *),Bash(git status)"
```
- Каждая строка stdout — JSON-событие: `system/init` (session_id), `assistant` (текст и
  `tool_use`), `user` (`tool_result`), финальный `result` (стоимость, длительность, токены).
- Продолжить работу агента: `claude -p "..." --resume <session_id>`.
- Флаги CLI меняются — сверяйтесь с `claude --help` и докой Claude Code (headless mode).

### 4.3 Другие движки
- Codex CLI: `codex exec --json "<промпт>"`.
- Gemini CLI: `gemini -p "<промпт>"` (проверить актуальный флаг JSON-вывода).
- Ollama (локальные модели, напр. Qwen-Coder) — бесплатно, но заметно слабее; годится для
  планировщика/черновиков, не для основной разработки.

Адаптер нормализует события разных CLI в один формат `AgentEvent` — UI не знает, какой движок внутри.

> Важно: подписку пользователь использует сам, через свой логин в CLI. Не проксируйте свою
> подписку другим людям — это нарушает условия провайдеров. Перед публичным релизом проверьте
> актуальные условия Anthropic/OpenAI/Google.

---

## 5. Основной сценарий (то, что вы описали)

### Шаг 1. Ввод ТЗ
- Большое поле ввода + возможность прикрепить файлы/скриншоты/ссылки.
- Planner сначала задаёт **уточняющие вопросы** (тип приложения, авторизация, платежи,
  мобильная версия, где хостить). Вайб-кодер не знает, что это важно, — система спрашивает за него.

### Шаг 2. Генерация плана (Planner)
Planner — тот же CLI-агент в headless-режиме с системным промптом «архитектора» и требованием
вернуть строго JSON. Ответ валидируется zod, при ошибке — повторный запрос с текстом ошибки.

```json
{
  "project": { "name": "shop", "stack": { "frontend": "Next.js", "backend": "NestJS",
               "db": "PostgreSQL + Prisma", "deploy": "Docker Compose" } },
  "agents": [
    { "id": "architect", "role": "Архитектор", "scope": ["docs/", "contracts/"],
      "engine": "claude-code", "goal": "OpenAPI-контракт и схема БД" },
    { "id": "backend",  "role": "Backend",  "scope": ["backend/"] },
    { "id": "frontend", "role": "Frontend", "scope": ["frontend/"] },
    { "id": "db",       "role": "База данных", "scope": ["backend/prisma/"] },
    { "id": "devops",   "role": "DevOps",   "scope": ["docker/", ".github/"] },
    { "id": "qa",       "role": "Тестировщик", "scope": ["tests/"] }
  ],
  "tasks": [
    { "id": "t1", "agent": "architect", "title": "Контракт API", "dependsOn": [] },
    { "id": "t2", "agent": "db",        "title": "Схема БД",     "dependsOn": ["t1"] },
    { "id": "t3", "agent": "backend",   "title": "Эндпоинты",    "dependsOn": ["t1","t2"] },
    { "id": "t4", "agent": "frontend",  "title": "Страницы",     "dependsOn": ["t1"] },
    { "id": "t5", "agent": "qa",        "title": "E2E-тесты",    "dependsOn": ["t3","t4"] },
    { "id": "t6", "agent": "devops",    "title": "Docker + CI",  "dependsOn": ["t3","t4"] }
  ]
}
```

Ключевой приём: **первым всегда работает Архитектор** и фиксирует контракты (OpenAPI, схема БД,
структура папок). После этого фронт и бэк можно запускать параллельно — они пишут по одному контракту.

### Шаг 3. Редактирование плана
- Карточки агентов (роль, движок, папки, промпт) — можно добавить/удалить/переименовать.
- Граф задач (React Flow) — перетаскивание зависимостей.
- Пояснения простым языком: «зачем нужен DevOps-агент» и т.п. — это и есть ценность для вайб-кодера.

### Шаг 4. Scaffolder
- `git init`, базовая структура папок по `scope`.
- `AGENTS.md` / `CLAUDE.md` в корне (общие правила, стек, контракты) и в папке каждого агента
  (его зона ответственности, запреты: «не трогай файлы вне frontend/»).
- Файл `.vibe/plan.json` — план живёт в репозитории, его видно и в обычном VS Code.

### Шаг 5. Кнопка «Запуск» (Orchestrator)
```
пока есть невыполненные задачи:
  ready = задачи, у которых все dependsOn = done
  запустить ready параллельно (лимит N одновременно, напр. 3)
  для каждой задачи:
    1. git worktree add .vibe/worktrees/<agent> -b agent/<agent>/<task>
    2. runner.run(prompt = роль + контракты + задача + критерии готовности)
    3. стримить события в UI и SQLite
    4. по завершении: lint + typecheck + тесты в worktree
    5. ок → merge в main; конфликт → задача агенту-интегратору; ошибка → повтор (до K раз) или статус «нужна помощь»
```
- Кнопки: Пауза / Стоп агента / Перезапуск задачи / «Написать агенту» (через `--resume`).
- Подтверждение опасных действий (удаление файлов, `rm`, установка пакетов) — через UI, а не автоматически.

### Шаг 6. Дашборд
- **Карточки агентов**: статус (ожидает / работает / проверка / готово / ошибка), текущее действие
  («редактирует backend/src/users.controller.ts»), время, токены/стоимость.
- **Канбан задач**: To do → In progress → Review → Done.
- **Живой лог** агента (xterm.js) и человекочитаемая лента событий.
- **Изменённые файлы** + diff (Monaco).
- **Превью**: кнопка «Запустить приложение» поднимает `docker compose up`/`npm run dev` и показывает сайт внутри окна.

---

## 6. Модель данных (SQLite)

```
projects (id, name, path, created_at)
specs    (id, project_id, raw_text, clarifications_json, plan_json, version)
agents   (id, project_id, role, engine, scope_json, system_prompt)
tasks    (id, project_id, agent_id, title, prompt, depends_on_json, status, attempts, branch)
runs     (id, task_id, session_id, started_at, finished_at, exit_code, cost_usd, tokens_in, tokens_out)
events   (id, run_id, ts, type, payload_json)          -- поток событий агента
files    (id, run_id, path, change_type)               -- какие файлы тронул агент
```

---

## 7. Структура вашего репозитория

```
visual-studio-vibe-code/
├─ apps/desktop/
│  ├─ src/main/            # Node: orchestrator, runners, git, db
│  │  ├─ runners/          # claude.ts, codex.ts, gemini.ts, ollama.ts
│  │  ├─ planner/          # промпты + zod-схемы плана
│  │  ├─ orchestrator/     # DAG, очередь, ретраи
│  │  ├─ workspace/        # worktree, merge, проверки
│  │  └─ db/               # drizzle schema
│  ├─ src/preload/
│  └─ src/renderer/        # React UI
│     ├─ pages/            # Projects, Spec, Plan, Run, Files
│     └─ components/       # AgentCard, TaskGraph, LogView, DiffView
├─ packages/shared/        # типы AgentEvent, Plan, IPC-контракты
└─ templates/              # шаблоны ролей агентов и стеков
   ├─ roles/               # architect.md, backend.md, frontend.md, db.md, devops.md, qa.md
   └─ stacks/              # nextjs-nestjs-postgres, react-fastapi, ...
```

---

## 8. Этапы разработки

### Этап 0 — Прототип ядра (без UI), ~1 неделя
- Node-скрипт: запускает `claude -p` с `stream-json`, парсит события, печатает в консоль.
- Planner: ТЗ → JSON-план, валидация zod.
- Последовательный запуск задач по плану в одной папке.
- **Цель**: доказать, что цепочка «ТЗ → план → код» работает.

### Этап 1 — MVP, ~3–4 недели
- Electron-оболочка, экраны: ТЗ → План → Запуск.
- Карточки агентов, лента событий, статус задач.
- Параллельный запуск + git worktree + автоматический merge.
- Только движок Claude Code, 1–2 шаблона стеков.

### Этап 2 — Удобство, ~3–4 недели
- Граф задач (React Flow), редактирование плана.
- Diff-просмотр, дерево файлов, встроенный терминал.
- Превью запущенного приложения.
- Проверки после задачи (lint/tests), ретраи, агент-интегратор для конфликтов.
- Подсчёт стоимости/лимитов.

### Этап 3 — Расширение
- Адаптеры Codex / Gemini / Ollama, выбор движка на агента.
- Шаблоны ролей и стеков, библиотека готовых команд агентов.
- Запуск агентов в Docker (безопасность).
- Деплой в один клик (Railway / Fly.io / VPS через Docker Compose).
- Импорт существующего проекта: агент анализирует папки и предлагает команду.

---

## 9. Риски и решения

| Риск | Решение |
|---|---|
| Агенты конфликтуют в одних файлах | worktree на агента + жёсткий `scope` в AGENTS.md + контракты от Архитектора |
| Фронт и бэк «не сходятся» | Единый OpenAPI-контракт, генерация клиента (openapi-typescript), QA-агент проверяет интеграцию |
| Лимиты подписки заканчиваются | Лимит параллельных агентов, показ расхода, очередь, выбор другого движка |
| Агент делает опасные команды | `--allowedTools` по роли, без `--dangerously-skip-permissions` вне контейнера, Docker-песочница |
| Planner выдаёт кривой JSON | zod-валидация + повтор с ошибкой; JSON Schema в промпте |
| Агент «застрял» | Таймаут, лимит попыток, статус «нужна помощь» с кнопкой «написать агенту» |
| Изменение флагов CLI | Весь вызов CLI изолирован в адаптере; версия CLI проверяется при старте |

---

## 10. Существующие аналоги (изучить перед стартом)
- **Vibe Kanban** — канбан для управления CLI-агентами (open source).
- **Claude Squad** — несколько агентов в tmux + git worktree.
- **Conductor** — параллельные Claude Code в worktree (macOS).
- **OpenHands** — open source платформа автономных агентов.
- **Kiro** — IDE с подходом «spec → задачи → код».

Ваше отличие: ориентация на **нетехнического пользователя** — автоматический подбор
архитектуры и команды агентов из ТЗ, объяснения простым языком, визуальный дашборд вместо кода.

---

## 11. С чего начать прямо сейчас
1. Установить Claude Code, залогиниться, выполнить вручную:
   `claude -p "создай hello.txt" --output-format stream-json --verbose` — посмотреть формат событий.
2. Написать `runners/claude.ts` (spawn + построчный JSON-парсинг) — это фундамент всего.
3. Написать промпт Planner и zod-схему плана, прогнать на 5–10 разных ТЗ.
4. Собрать оркестратор DAG в консоли (Этап 0).
5. Только после этого — Electron UI.
