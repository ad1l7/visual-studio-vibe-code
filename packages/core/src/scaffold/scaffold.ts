import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSpec, Plan } from '../plan/schema.ts';
import { ProjectStore } from '../storage.ts';
import { commitAll } from '../workspace/git.ts';
import { Workspace } from '../workspace/worktrees.ts';

const MARK = '<!-- Сгенерировано Vibe Studio по .vibe/plan.json. Изменения вносите в план. -->';

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

/**
 * Готовит репозиторий к запуску: git, папки агентов, AGENTS.md/CLAUDE.md, план.
 * Безопасно вызывать повторно — генерируемые файлы перезаписываются, остальное не трогается.
 */
export async function scaffoldProject(projectDir: string, plan: Plan, spec?: string): Promise<Workspace> {
  const ws = await Workspace.open(projectDir);
  const store = new ProjectStore(ws.projectDir);
  await store.ensure();
  await store.savePlan(plan);
  if (spec !== undefined) await store.saveSpec(spec);

  await writeFile(join(ws.projectDir, 'AGENTS.md'), renderAgentsMd(plan));
  // Claude Code читает CLAUDE.md; импортируем общий AGENTS.md, чтобы не дублировать.
  const claudeMd = join(ws.projectDir, 'CLAUDE.md');
  if (!existsSync(claudeMd) || (await readFile(claudeMd, 'utf8')).startsWith(MARK)) {
    await writeFile(claudeMd, `${MARK}\n@AGENTS.md\n`);
  }

  await mkdir(join(store.vibeDir, 'agents'), { recursive: true });
  for (const agent of plan.agents) {
    await writeFile(join(store.vibeDir, 'agents', `${agent.id}.md`), renderAgentFile(agent));
    for (const scope of agent.scope.filter((s) => s.endsWith('/'))) {
      const dir = join(ws.projectDir, scope);
      await mkdir(dir, { recursive: true });
      const keep = join(dir, '.gitkeep');
      if (!existsSync(keep)) await writeFile(keep, '');
    }
  }

  const gitignore = join(ws.projectDir, '.gitignore');
  if (!existsSync(gitignore)) await writeFile(gitignore, 'node_modules/\ndist/\n.env\n*.log\n.DS_Store\n');

  await commitAll(ws.projectDir, 'vibe: каркас проекта по плану');
  return ws;
}
