import "server-only";

import fs from "fs";
import path from "path";
import type {
  DriveMigrationTask,
  MigrateItemParam,
  MigrationTaskItemDetail,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "drive-migrations.json");

interface DriveMigrationStore {
  tasks: DriveMigrationTask[];
}

declare global {
  // eslint-disable-next-line no-var
  var __driveMigrationStore__: DriveMigrationStore | undefined;
  // eslint-disable-next-line no-var
  var __driveMigrationStoreMtime__: number | undefined;
}

function now() {
  return new Date().toISOString();
}

function emptyStore(): DriveMigrationStore {
  return { tasks: [] };
}

function loadStore(): DriveMigrationStore {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const mtime = fs.statSync(STORE_FILE).mtimeMs;
    if (global.__driveMigrationStore__ && global.__driveMigrationStoreMtime__ === mtime) {
      return global.__driveMigrationStore__;
    }
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as DriveMigrationStore;
    const store = Array.isArray(parsed.tasks) ? parsed : emptyStore();
    global.__driveMigrationStore__ = store;
    global.__driveMigrationStoreMtime__ = mtime;
    return store;
  } catch (error) {
    console.error("读取个人网盘迁移任务记录失败:", error);
    return emptyStore();
  }
}

function persist(store: DriveMigrationStore) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporary = `${STORE_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(temporary, STORE_FILE);
    global.__driveMigrationStore__ = store;
    global.__driveMigrationStoreMtime__ = fs.statSync(STORE_FILE).mtimeMs;
  } catch (error) {
    console.error("写入个人网盘迁移任务记录失败:", error);
  }
}

export function getDriveMigrationTasks(): DriveMigrationTask[] {
  return loadStore().tasks;
}

export function getDriveMigrationTask(id: string): DriveMigrationTask | undefined {
  return loadStore().tasks.find((t) => t.id === id);
}

export function createDriveMigrationTask(input: {
  name?: string;
  targetWikiUrl: string;
  targetParentNodeToken?: string;
  items: MigrateItemParam[];
}): DriveMigrationTask {
  const store = loadStore();
  const id = `dmt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const currentTime = now();

  const taskItems: MigrationTaskItemDetail[] = input.items.map((item) => ({
    token: item.token,
    name: item.name,
    type: item.type,
    customTargetParentToken: item.customTargetParentToken,
    status: item.type === "folder" ? "skipped" : "pending",
    error: item.type === "folder" ? "文件夹暂不直接迁移" : undefined,
  }));

  const initialSkipped = taskItems.filter((i) => i.status === "skipped").length;

  const task: DriveMigrationTask = {
    id,
    name: input.name || `迁移任务 (${input.items.length} 篇文档)`,
    targetWikiUrl: input.targetWikiUrl,
    targetParentNodeToken: input.targetParentNodeToken,
    status: "running",
    progress: {
      total: input.items.length,
      completed: initialSkipped,
      success: 0,
      failed: 0,
      skipped: initialSkipped,
    },
    items: taskItems,
    createdAt: currentTime,
    updatedAt: currentTime,
  };

  store.tasks.unshift(task);
  // 最多保留最新 50 条任务记录
  if (store.tasks.length > 50) {
    store.tasks = store.tasks.slice(0, 50);
  }
  persist(store);
  return task;
}

export function updateDriveMigrationTask(
  id: string,
  updates: Partial<DriveMigrationTask>,
): DriveMigrationTask | undefined {
  const store = loadStore();
  const task = store.tasks.find((t) => t.id === id);
  if (!task) return undefined;

  Object.assign(task, updates, { updatedAt: now() });
  persist(store);
  return task;
}

export function updateDriveMigrationTaskItem(
  taskId: string,
  token: string,
  updates: Partial<MigrationTaskItemDetail>,
): void {
  const store = loadStore();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const item = task.items.find((i) => i.token === token);
  if (!item) return;

  Object.assign(item, updates);
  task.updatedAt = now();
  persist(store);
}

export function clearCompletedDriveMigrationTasks(): void {
  const store = loadStore();
  store.tasks = store.tasks.filter((t) => t.status === "running" || t.status === "pending");
  persist(store);
}
