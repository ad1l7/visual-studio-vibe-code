import { readFileSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeRunner } from '../src/runners/claude.ts';
import { parseClaudeLine } from '../src/runners/claudeParser.ts';
import type { AgentEvent } from '../src/runners/types.ts';
import { tempDir } from './helpers.ts';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'claude-stream.jsonl');

describe('разбор stream-json от Claude Code', () => {
  it('нормализует записанный реальный поток', () => {
    const events = readFileSync(FIXTURE, 'utf8')
      .split('\n')
      .flatMap((l) => parseClaudeLine(l, '/tmp/vibe-fixture'));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('session');
    expect(types).toContain('tool');
    expect(types).toContain('tool_result');
    expect(types).toContain('status');
    const result = events.at(-1)!;
    expect(result.type).toBe('result');
    if (result.type === 'result') {
      expect(result.result.ok).toBe(true);
      expect(result.result.costUsd).toBeGreaterThan(0);
      expect(result.result.sessionId).toBe('00000000-0000-4000-8000-000000000001');
    }
  });

  it('пишет понятное описание действий с относительными путями', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: '1', name: 'Edit', input: { file_path: '/w/backend/src/a.ts' } }] },
    });
    const [ev] = parseClaudeLine(line, '/w');
    expect(ev).toMatchObject({ type: 'tool', summary: 'Редактирует backend/src/a.ts' });
  });

  it('распознаёт ошибку и structured output', () => {
    const err = parseClaudeLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.1 }), '/');
    expect(err[0]).toMatchObject({ type: 'result', result: { ok: false } });
    const ok = parseClaudeLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, structured_output: { a: 1 } }), '/');
    expect(ok[0]).toMatchObject({ type: 'result', result: { ok: true, structured: { a: 1 } } });
  });
});

describe('ClaudeCodeRunner', () => {
  async function fakeCli(dir: string) {
    const script = join(dir, 'fake-claude.mjs');
    await writeFile(
      script,
      `import { readFileSync, writeFileSync } from 'node:fs';
const input = readFileSync(0, 'utf8');
writeFileSync(${JSON.stringify(join(dir, 'call.json'))}, JSON.stringify({ args: process.argv.slice(2), input, cwd: process.cwd() }));
process.stdout.write(readFileSync(${JSON.stringify(FIXTURE)}, 'utf8'));
`,
    );
    await chmod(script, 0o755);
    return new ClaudeCodeRunner({ command: process.execPath, baseArgs: [script] });
  }

  it('передаёт промпт через stdin, флаги — аргументами, и отдаёт события', async () => {
    const dir = await tempDir();
    const runner = await fakeCli(dir);
    const events: AgentEvent[] = [];
    for await (const e of runner.run({
      cwd: dir,
      prompt: 'длинный промпт задачи',
      systemPrompt: 'ты backend',
      model: 'sonnet',
      permissionMode: 'acceptEdits',
      allowedTools: ['Read', 'Bash(npm *)'],
      resumeSessionId: 'sess-1',
      meta: { purpose: 'task' },
    })) events.push(e);

    const call = JSON.parse(await readFile(join(dir, 'call.json'), 'utf8'));
    expect(call.input).toBe('длинный промпт задачи');
    expect(call.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--resume', 'sess-1', 'Bash(npm *)']));
    expect(call.args[call.args.indexOf('--append-system-prompt') + 1]).toBe('ты backend');
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { ok: true } });
  });

  it('если CLI не установлен — возвращает понятную ошибку', async () => {
    const runner = new ClaudeCodeRunner({ command: 'definitely-not-installed-claude' });
    expect((await runner.info()).available).toBe(false);
    const events: AgentEvent[] = [];
    for await (const e of runner.run({ cwd: process.cwd(), prompt: 'x', meta: { purpose: 'task' } })) events.push(e);
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { ok: false, error: expect.stringContaining('не удалось запустить') } });
  });
});
