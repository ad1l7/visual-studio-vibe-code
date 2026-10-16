// Чистые функции без Node-зависимостей: используются и в браузере (демо).
import type { AgentSpec, Plan } from '../plan/schema.ts';

export const MARK = '<!-- Сгенерировано Vibe Studio по .vibe/plan.json. Изменения вносите в план. -->';

export function renderAgentsMd(plan: Plan): string {
  const { project } = plan;
  const stack = Object.entries(project.stack)
    .filter(([, v]) => v)
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join('\n');
  const agents = plan.agents
    .map((a) => `### ${a.role} (\`${a.id}\`)\n${a.description}\n\nЗона: ${a.scope.map((s) => `\`${s}\``).join(', ')}`)
    .join('\n\n');
  return `${MARK}
# ${project.name}

${project.summary}

## Стек
${stack || '- (не указан)'}

${project.stackReasoning ? `${project.stackReasoning}\n\n` : ''}## Команда агентов
${agents}

## Общие правила
- Каждый агент меняет только файлы в своей зоне. Нужны правки в чужой зоне — опиши их в итоговом отчёте.
- Договорённости между частями системы (API, схема данных) — в \`contracts/\` и \`docs/\`. Сначала читай их.
- Не коммить секреты: ключи и пароли — только в \`.env\` (он в .gitignore), пример — в \`.env.example\`.
- Не выполняй \`git push\`, \`git checkout\`, \`git reset\` и не переключай ветки: этим управляет студия.
- Пиши код так, чтобы его понял следующий агент: понятные имена, README в каждой части.
`;
}

export function renderAgentFile(agent: AgentSpec): string {
  return `${MARK}
# ${agent.role}

${agent.description}

## Зона ответственности
${agent.scope.map((s) => `- \`${s}\``).join('\n')}
${agent.instructions ? `\n## Правила\n${agent.instructions}\n` : ''}${agent.checkCommand ? `\n## Проверка\n\`${agent.checkCommand}\`\n` : ''}`;
}
