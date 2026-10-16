import { Clarification, Plan, toAgentJsonSchema, type Answers, type ClarifyQuestion } from '../plan/schema.ts';
import { parsePlan, PlanError } from '../plan/validate.ts';
import { runToResult, type AgentEvent, type AgentRunner } from '../runners/types.ts';
import { buildFullSpec, CLARIFY_SYSTEM, clarifyPrompt, PLAN_SYSTEM, planPrompt } from './prompts.ts';

export interface PlannerOptions {
  runner: AgentRunner;
  /** Папка, в которой запускается планировщик (проект или пустая папка). */
  cwd: string;
  model?: string;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}

// Планировщик только думает: запрещаем ему менять файлы и выполнять команды.
const READ_ONLY = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];

export async function clarify(spec: string, o: PlannerOptions): Promise<ClarifyQuestion[]> {
  const result = await runToResult(
    o.runner,
    {
      cwd: o.cwd,
      prompt: clarifyPrompt(buildFullSpec(spec)),
      systemPrompt: CLARIFY_SYSTEM,
      model: o.model,
      jsonSchema: toAgentJsonSchema(Clarification),
      disallowedTools: READ_ONLY,
      signal: o.signal,
      meta: { purpose: 'clarify' },
    },
    o.onEvent,
  );
  if (!result.ok) throw new Error(`Не удалось получить уточняющие вопросы: ${result.error}`);
  const parsed = Clarification.safeParse(result.structured ?? tryJson(result.text));
  if (!parsed.success) throw new Error('Агент вернул вопросы в неверном формате');
  return parsed.data.questions;
}

export interface GeneratePlanInput {
  spec: string;
  questions?: ClarifyQuestion[];
  answers?: Answers;
  /** Сколько раз переспросить агента, если план не прошёл проверку. */
  maxRetries?: number;
}

export async function generatePlan(input: GeneratePlanInput, o: PlannerOptions): Promise<Plan> {
  const fullSpec = buildFullSpec(input.spec, input.questions, input.answers);
  const schema = toAgentJsonSchema(Plan);
  const attempts = (input.maxRetries ?? 2) + 1;
  let lastError: string | undefined;

  for (let i = 0; i < attempts; i++) {
    const result = await runToResult(
      o.runner,
      {
        cwd: o.cwd,
        prompt: planPrompt(fullSpec, lastError),
        systemPrompt: PLAN_SYSTEM,
        model: o.model,
        jsonSchema: schema,
        disallowedTools: READ_ONLY,
        signal: o.signal,
        meta: { purpose: 'plan' },
      },
      o.onEvent,
    );
    if (!result.ok) throw new Error(`Планировщик завершился с ошибкой: ${result.error}`);
    try {
      return parsePlan(result.structured ?? tryJson(result.text));
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      lastError = err.problems.join('\n');
      if (i < attempts - 1) o.onEvent?.({ type: 'status', text: `План не прошёл проверку, переделываю (попытка ${i + 2} из ${attempts})` });
    }
  }
  throw new Error(`Планировщик не смог составить корректный план:\n${lastError}`);
}

function tryJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}
