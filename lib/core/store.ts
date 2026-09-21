import fs from "fs";
import path from "path";
import { listBotDefinitions } from "../bots/index";
import { loadAllBotConfigs, loadBotConfigById } from "./config-loader";
import { BotConfig, PublicBotConfig, ReminderSchedule, ReminderTask, RotationMember } from "./types";

type GlobalStore = {
  bots: BotConfig[];
  schedules: ReminderSchedule[];
  tasks: ReminderTask[];
};

declare global {
  // eslint-disable-next-line no-var
  var __febotCoreStore__: GlobalStore | undefined;
}

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_FILE = path.join(DATA_DIR, "store.json");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function atomicWriteJson(filePath: string, data: unknown) {
  ensureDataDir();
  const tmpFile = `${filePath}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpFile, filePath);
}

function loadConfigFromFile(): { bots: BotConfig[]; schedules: ReminderSchedule[] } | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.bots) && Array.isArray(parsed.schedules)) {
        return {
          bots: parsed.bots,
          schedules: parsed.schedules,
        };
      }
    }
  } catch (error) {
    console.error("读取 data/store.json 失败:", error);
  }
  return null;
}

function loadTasksFromFile(): ReminderTask[] | null {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const content = fs.readFileSync(TASKS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    console.error("读取 data/tasks.json 失败:", error);
  }
  return null;
}

function persistConfig(state: GlobalStore) {
  try {
    atomicWriteJson(CONFIG_FILE, {
      bots: state.bots,
      schedules: state.schedules,
    });
  } catch (error) {
    console.error("保存配置到 data/store.json 失败:", error);
  }
}

function persistTasks(tasks: ReminderTask[]) {
  try {
    atomicWriteJson(TASKS_FILE, tasks);
  } catch (error) {
    console.error("保存历史记录到 data/tasks.json 失败:", error);
  }
}

function persistStore(state: GlobalStore) {
  persistConfig(state);
  persistTasks(state.tasks);
}

function initStore(): GlobalStore {
  if (global.__febotCoreStore__) return global.__febotCoreStore__;

  // 1. 先尝试从本地文件恢复配置与历史记录
  const configFromFile = loadConfigFromFile();
  let tasksFromFile = loadTasksFromFile();

  if (configFromFile) {
    const state: GlobalStore = {
      bots: configFromFile.bots,
      schedules: configFromFile.schedules,
      tasks: tasksFromFile ?? [],
    };
    // 检查是否有新注册或在 config/ 中定义的 Bot
    const registered = listBotDefinitions();
    let hasNew = false;
    registered.forEach((def) => {
      const cfg = loadBotConfigById(def.id);
      if (!state.bots.some((b) => b.id === def.id)) {
        state.bots.push({
          id: def.id,
          name: def.name,
          webhookUrl: cfg?.bot.webhookUrl || undefined,
          enabled: cfg?.bot.enabled ?? true,
        });
        hasNew = true;
      }
      if (def.defaultSchedule && !state.schedules.some((s) => s.id === `${def.id}-schedule` || s.botId === def.id)) {
        state.schedules.push({
          id: `${def.id}-schedule`,
          name: def.defaultSchedule.name,
          botId: def.id,
          type: def.defaultSchedule.type || (def.id === "weekly-report" ? "weekly_report" : "rotation_reminder"),
          documentId: def.defaultDocumentId,
          sourceDocumentId: def.defaultSchedule.sourceDocumentId || (cfg?.schedule as any)?.sourceDocumentId || "",
          targetFolderId: def.defaultSchedule.targetFolderId || (cfg?.schedule as any)?.targetFolderId || "",
          dayOfWeek: def.defaultSchedule.dayOfWeek,
          time: def.defaultSchedule.time,
          timezone: "Asia/Shanghai",
          enabled: true,
          rotationStartAt: def.defaultSchedule.rotationStartAt,
          currentIndex: def.defaultSchedule.currentIndex ?? 0,
          rotation: def.defaultSchedule.initialMembers || [{ name: "系统自动" }],
        });
        hasNew = true;
      }
    });

    state.schedules.forEach((s) => {
      if (typeof s.currentIndex !== "number" || Number.isNaN(s.currentIndex)) {
        s.currentIndex = 0;
        hasNew = true;
      }
      if (!s.type) {
        s.type = s.id.includes("weekly-report") ? "weekly_report" : "rotation_reminder";
        hasNew = true;
      }
    });

    global.__febotCoreStore__ = state;
    if (hasNew) persistConfig(state);
    return global.__febotCoreStore__;
  }

  // 2. 文件不存在，从 Bot 插件与 config/*.json 初始化
  const registered = listBotDefinitions();
  const initialBots: BotConfig[] = [];
  const initialSchedules: ReminderSchedule[] = [];

  registered.forEach((def) => {
    const cfg = loadBotConfigById(def.id);
    const webhookUrl = cfg?.bot.webhookUrl;
    initialBots.push({
      id: def.id,
      name: def.name,
      webhookUrl: webhookUrl || undefined,
      enabled: cfg?.bot.enabled ?? true,
    });

    if (def.defaultSchedule) {
      initialSchedules.push({
        id: `${def.id}-schedule`,
        name: def.defaultSchedule.name,
        botId: def.id,
        type: def.defaultSchedule.type || (def.id === "weekly-report" ? "weekly_report" : "rotation_reminder"),
        documentId: def.defaultDocumentId,
        sourceDocumentId: def.defaultSchedule.sourceDocumentId || (cfg?.schedule as any)?.sourceDocumentId || "",
        targetFolderId: def.defaultSchedule.targetFolderId || (cfg?.schedule as any)?.targetFolderId || "",
        dayOfWeek: def.defaultSchedule.dayOfWeek,
        time: def.defaultSchedule.time,
        timezone: "Asia/Shanghai",
        enabled: true,
        rotationStartAt: def.defaultSchedule.rotationStartAt,
        currentIndex: def.defaultSchedule.currentIndex ?? 0,
        rotation: def.defaultSchedule.initialMembers || [{ name: "系统自动" }],
      });
    }
  });

  const newStore: GlobalStore = {
    bots: initialBots,
    schedules: initialSchedules,
    tasks: tasksFromFile ?? [],
  };

  global.__febotCoreStore__ = newStore;
  persistStore(newStore);
  return global.__febotCoreStore__;
}


function getStore(): GlobalStore {
  return initStore();
}

/* ==================== Bot 管理能力 ==================== */

export function getBots(): BotConfig[] {
  return getStore().bots;
}

export function getBot(id: string): BotConfig | undefined {
  return getStore().bots.find((item) => item.id === id);
}

export function getPublicBots(): PublicBotConfig[] {
  return getStore().bots.map(({ webhookUrl, ...bot }) => ({
    ...bot,
    configured: Boolean(webhookUrl),
    webhookMasked: maskWebhook(webhookUrl),
  }));
}

function maskWebhook(webhookUrl: string | undefined): string {
  if (!webhookUrl) return "未配置";
  const key = webhookUrl.split("/").at(-1) ?? "";
  return `…/${key.slice(0, 6)}••••${key.slice(-4)}`;
}

export function createBot(input: Pick<BotConfig, "name" | "webhookUrl">): BotConfig {
  const base = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "bot";
  let id = base;
  let index = 2;
  while (getBot(id)) id = `${base}-${index++}`;
  const bot: BotConfig = { id, name: input.name.trim(), webhookUrl: input.webhookUrl, enabled: true };
  const store = getStore();
  store.bots.push(bot);
  persistConfig(store);
  return bot;
}

export function updateBot(id: string, changes: Partial<Pick<BotConfig, "name" | "webhookUrl" | "enabled">>): BotConfig | undefined {
  const bot = getBot(id);
  if (!bot) return undefined;
  Object.entries(changes).forEach(([key, value]) => {
    if (value !== undefined) (bot as unknown as Record<string, unknown>)[key] = value;
  });
  persistConfig(getStore());
  return bot;
}

export function deleteBot(id: string): boolean | "BOT_IN_USE" | undefined {
  if (getSchedules().some((schedule) => schedule.botId === id)) return "BOT_IN_USE";
  const store = getStore();
  const index = store.bots.findIndex((item) => item.id === id);
  if (index < 0) return undefined;
  store.bots.splice(index, 1);
  persistConfig(store);
  return true;
}

/* ==================== Schedule 调度规则管理 ==================== */

export function getSchedules(): ReminderSchedule[] {
  return getStore().schedules;
}

export function getSchedule(id: string): ReminderSchedule | undefined {
  return getStore().schedules.find((item) => item.id === id);
}

export function updateSchedule(id: string, changes: Partial<ReminderSchedule>): ReminderSchedule | undefined {
  const schedule = getSchedule(id);
  if (!schedule) return undefined;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      delete (schedule as unknown as Record<string, unknown>)[key];
    } else {
      (schedule as unknown as Record<string, unknown>)[key] = value;
    }
  }
  persistConfig(getStore());
  return schedule;
}

export function replaceRotation(id: string, rotation: RotationMember[]): ReminderSchedule | undefined {
  return updateSchedule(id, { rotation });
}

export function postponeScheduleDate(id: string, dateKey: string): ReminderSchedule | undefined {
  const schedule = getSchedule(id);
  if (!schedule) return undefined;
  const postponedDates = new Set(schedule.postponedDates ?? []);
  postponedDates.add(dateKey);
  return updateSchedule(id, { postponedDates: [...postponedDates].sort() });
}

export function resetSchedulePostponements(id: string): ReminderSchedule | undefined {
  return updateSchedule(id, { postponedDates: [] });
}

export function updateScheduleHostOverrides(
  id: string,
  hostOverrides: Record<string, RotationMember>,
): ReminderSchedule | undefined {
  return updateSchedule(id, { hostOverrides });
}

export function resetScheduleHostOverrides(id: string): ReminderSchedule | undefined {
  return updateSchedule(id, { hostOverrides: {} });
}

/* ==================== Task 历史与状态记录 ==================== */

export function recordTask(task: ReminderTask): ReminderTask {
  const state = getStore();
  // 每次发送都保留一条记录，即使同一个定时任务被手动重试多次。
  state.tasks.unshift(task);
  state.tasks.splice(5000);
  persistTasks(state.tasks);
  return task;
}

export function getRecentTasks(): ReminderTask[] {
  const tasksFromFile = loadTasksFromFile();
  const state = getStore();
  if (tasksFromFile !== null) {
    state.tasks = tasksFromFile;
  }
  return state.tasks;
}
