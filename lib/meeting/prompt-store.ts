import "server-only";

import fs from "fs";
import path from "path";
import { DEFAULT_MEETING_PROMPTS } from "./prompts";
import type { MeetingPromptTemplate, MeetingScenario } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "meeting-prompts.json");

interface PromptStore {
  prompts: MeetingPromptTemplate[];
}

function timestamp() {
  return new Date().toISOString();
}

function builtInPrompts(): MeetingPromptTemplate[] {
  const createdAt = timestamp();
  return DEFAULT_MEETING_PROMPTS.map((prompt) => ({ ...prompt, builtIn: true, createdAt, updatedAt: createdAt }));
}

function persist(store: PromptStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(temporary, STORE_FILE);
}

function loadStore(): PromptStore {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      const initial = { prompts: builtInPrompts() };
      persist(initial);
      return initial;
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as PromptStore;
    if (!Array.isArray(parsed.prompts)) throw new Error("Prompt 模板数据格式错误");
    const missing = DEFAULT_MEETING_PROMPTS.filter((item) => !parsed.prompts.some((prompt) => prompt.id === item.id));
    if (missing.length) {
      const createdAt = timestamp();
      parsed.prompts.unshift(...missing.map((prompt) => ({ ...prompt, builtIn: true, createdAt, updatedAt: createdAt })));
      persist(parsed);
    }
    return parsed;
  } catch (error) {
    console.error("读取会议 Prompt 模板失败:", error);
    return { prompts: builtInPrompts() };
  }
}

export function listMeetingPrompts() {
  return [...loadStore().prompts].sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || b.updatedAt.localeCompare(a.updatedAt));
}

export function getMeetingPrompt(id: string) {
  return loadStore().prompts.find((prompt) => prompt.id === id);
}

export function createMeetingPrompt(input: {
  name: string;
  description: string;
  scenario: MeetingScenario;
  instructions: string;
}) {
  const store = loadStore();
  const createdAt = timestamp();
  const prompt: MeetingPromptTemplate = {
    id: `prompt_${crypto.randomUUID()}`,
    name: input.name.trim(),
    description: input.description.trim(),
    scenario: input.scenario,
    instructions: input.instructions.trim(),
    builtIn: false,
    createdAt,
    updatedAt: createdAt,
  };
  store.prompts.push(prompt);
  persist(store);
  return prompt;
}

export function updateMeetingPrompt(id: string, input: {
  name?: string;
  description?: string;
  scenario?: MeetingScenario;
  instructions?: string;
}) {
  const store = loadStore();
  const prompt = store.prompts.find((item) => item.id === id);
  if (!prompt) return undefined;
  if (input.name !== undefined) prompt.name = input.name.trim();
  if (input.description !== undefined) prompt.description = input.description.trim();
  if (input.scenario !== undefined) prompt.scenario = input.scenario;
  if (input.instructions !== undefined) prompt.instructions = input.instructions.trim();
  prompt.updatedAt = timestamp();
  persist(store);
  return prompt;
}

export function deleteMeetingPrompt(id: string) {
  const store = loadStore();
  const index = store.prompts.findIndex((item) => item.id === id);
  if (index === -1 || store.prompts[index].builtIn) return false;
  store.prompts.splice(index, 1);
  persist(store);
  return true;
}

export function resetMeetingPrompt(id: string) {
  const definition = DEFAULT_MEETING_PROMPTS.find((item) => item.id === id);
  if (!definition) return undefined;
  return updateMeetingPrompt(id, definition);
}
