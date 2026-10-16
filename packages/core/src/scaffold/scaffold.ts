import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plan } from '../plan/schema.ts';
import { MARK, renderAgentFile, renderAgentsMd } from './render.ts';
import { ProjectStore } from '../storage.ts';
import { commitAll } from '../workspace/git.ts';
import { Workspace } from '../workspace/worktrees.ts';

export { renderAgentFile, renderAgentsMd } from './render.ts';

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
