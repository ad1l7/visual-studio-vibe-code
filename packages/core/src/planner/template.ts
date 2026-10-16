import type { Clarification, PlanInput } from '../plan/schema.ts';

/**
 * Типовая команда для веб-приложения. Используется mock-движком (демо и тесты)
 * и как пример формата плана в промпте планировщика.
 */
export function templatePlan(spec: string): PlanInput {
  const firstLine = spec.trim().split(/\n/)[0] ?? 'Новый проект';
  return {
    project: {
      name: firstLine.slice(0, 60) || 'Новый проект',
      summary: `Веб-приложение по ТЗ: ${firstLine.slice(0, 200)}`,
      stack: {
        frontend: 'React + Vite + TypeScript',
        backend: 'Node.js + Fastify + TypeScript',
        database: 'PostgreSQL + Prisma',
        devops: 'Docker Compose',
        other: '',
      },
      stackReasoning: 'Популярный и хорошо документированный стек: одна технология (TypeScript) на фронте и бэке.',
    },
    agents: [
      {
        id: 'architect',
        role: 'Архитектор',
        description: 'Продумывает устройство системы и фиксирует договорённости: какие есть данные и как фронт общается с бэком. Остальные агенты работают по его документам.',
        scope: ['docs/', 'contracts/'],
      },
      {
        id: 'database',
        role: 'Инженер базы данных',
        description: 'Проектирует, где и как хранятся данные: таблицы, связи, миграции.',
        scope: ['backend/prisma/'],
      },
      {
        id: 'backend',
        role: 'Backend-разработчик',
        description: 'Пишет серверную часть: логику, API, проверку прав. Это «мозг» приложения, который пользователь не видит.',
        scope: ['backend/'],
      },
      {
        id: 'frontend',
        role: 'Frontend-разработчик',
        description: 'Делает то, что видит пользователь: страницы, кнопки, формы.',
        scope: ['frontend/'],
      },
      {
        id: 'devops',
        role: 'DevOps-инженер',
        description: 'Делает так, чтобы всё запускалось одной командой локально и на сервере.',
        scope: ['docker/', '.github/', 'docker-compose.yml'],
      },
      {
        id: 'qa',
        role: 'Тестировщик',
        description: 'Пишет автотесты и проверяет, что фронт и бэк работают вместе.',
        scope: ['tests/'],
      },
    ],
    tasks: [
      {
        id: 'architecture',
        agentId: 'architect',
        title: 'Архитектура и контракты',
        description: 'Описать модули системы в docs/architecture.md, контракт API в contracts/openapi.yaml и модель данных в docs/data-model.md.',
        acceptance: ['Есть docs/architecture.md', 'Есть contracts/openapi.yaml'],
        dependsOn: [],
      },
      {
        id: 'db-schema',
        agentId: 'database',
        title: 'Схема базы данных',
        description: 'Создать схему БД по docs/data-model.md.',
        acceptance: ['Схема соответствует модели данных'],
        dependsOn: ['architecture'],
      },
      {
        id: 'api',
        agentId: 'backend',
        title: 'Серверное API',
        description: 'Реализовать эндпоинты из contracts/openapi.yaml.',
        acceptance: ['Все эндпоинты из контракта реализованы'],
        dependsOn: ['architecture', 'db-schema'],
      },
      {
        id: 'ui',
        agentId: 'frontend',
        title: 'Интерфейс',
        description: 'Сделать страницы приложения, обращающиеся к API по контракту.',
        acceptance: ['Все экраны из архитектуры реализованы'],
        dependsOn: ['architecture'],
      },
      {
        id: 'infra',
        agentId: 'devops',
        title: 'Запуск одной командой',
        description: 'Docker Compose для фронта, бэка и БД.',
        acceptance: ['docker compose up поднимает всё приложение'],
        dependsOn: ['api', 'ui'],
      },
      {
        id: 'e2e',
        agentId: 'qa',
        title: 'Сквозные тесты',
        description: 'Тесты основных сценариев пользователя.',
        acceptance: ['Тесты проходят'],
        dependsOn: ['api', 'ui'],
      },
    ],
  };
}

export function templateClarification(): Clarification {
  return {
    questions: [
      {
        id: 'users',
        question: 'Нужна ли регистрация и вход пользователей?',
        why: 'От этого зависит, нужна ли система учётных записей и защита данных.',
        options: ['Да, по email и паролю', 'Да, через Google', 'Нет, без входа'],
      },
      {
        id: 'platform',
        question: 'Где будут пользоваться продуктом?',
        why: 'Определяет, делать сайт, мобильное приложение или и то и другое.',
        options: ['Сайт (компьютер и телефон)', 'Мобильное приложение', 'Оба варианта'],
      },
    ],
  };
}
