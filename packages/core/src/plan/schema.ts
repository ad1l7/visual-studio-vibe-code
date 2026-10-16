import { z } from 'zod';

export const ENGINE_IDS = ['claude-code', 'mock'] as const;
export const EngineId = z.enum(ENGINE_IDS);
export type EngineId = z.infer<typeof EngineId>;

const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'id: только латиница в нижнем регистре, цифры и дефис');

export const AgentSpec = z.object({
  id: Id.describe('Короткий id агента, например "backend"'),
  role: z.string().min(1).describe('Название роли по-русски, например "Backend-разработчик"'),
  description: z
    .string()
    .min(1)
    .describe('Простыми словами: за что отвечает агент и зачем он нужен проекту'),
  scope: z
    .array(z.string().min(1))
    .min(1)
    .describe('Папки проекта, которые агент может менять, например ["backend/"]'),
  instructions: z
    .string()
    .default('')
    .describe('Дополнительные правила для агента: стек, стиль кода, ограничения'),
  checkCommand: z
    .string()
    .optional()
    .describe('Команда проверки результата (тесты/линтер), запускается в корне проекта'),
  engine: EngineId.optional(),
});
export type AgentSpec = z.infer<typeof AgentSpec>;

export const TaskSpec = z.object({
  id: Id.describe('Короткий id задачи, например "api-contract"'),
  agentId: z.string().min(1).describe('id агента-исполнителя'),
  title: z.string().min(1),
  description: z.string().min(1).describe('Что именно сделать, достаточно подробно для одного агента'),
  acceptance: z.array(z.string()).default([]).describe('Критерии готовности'),
  dependsOn: z.array(z.string()).default([]).describe('id задач, которые должны быть выполнены раньше'),
});
export type TaskSpec = z.infer<typeof TaskSpec>;

export const Stack = z.object({
  frontend: z.string().default(''),
  backend: z.string().default(''),
  database: z.string().default(''),
  devops: z.string().default(''),
  other: z.string().default(''),
});
export type Stack = z.infer<typeof Stack>;

export const Plan = z.object({
  project: z.object({
    name: z.string().min(1),
    summary: z.string().min(1).describe('Что за продукт, 2–4 предложения простым языком'),
    stack: Stack,
    stackReasoning: z.string().default('').describe('Почему выбран такой стек, простыми словами'),
  }),
  agents: z.array(AgentSpec).min(1),
  tasks: z.array(TaskSpec).min(1),
});
export type Plan = z.infer<typeof Plan>;
export type PlanInput = z.input<typeof Plan>;

export const ClarifyQuestion = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  why: z.string().default('').describe('Почему это важно, простыми словами'),
  options: z.array(z.string()).default([]).describe('Варианты ответа, если уместны'),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestion>;

export const Clarification = z.object({
  questions: z.array(ClarifyQuestion).max(7),
});
export type Clarification = z.infer<typeof Clarification>;

export type Answers = Record<string, string>;

/** JSON Schema для structured output CLI-агента (без служебного $schema). */
export function toAgentJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
