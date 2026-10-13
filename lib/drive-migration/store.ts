import "server-only";

import fs from "fs";
import path from "path";
import type {
  DriveFolderStat,
  DriveMigrationStats,
  DriveMigrationTask,
  MigrateItemParam,
  MigratedFileRecord,
  MigrationTaskItemDetail,
  TargetWikiStat,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "drive-migrations.json");
const STATS_FILE = path.join(DATA_DIR, "drive-migration-stats.json");

interface DriveMigrationStore {
  tasks: DriveMigrationTask[];
}

declare global {
  // eslint-disable-next-line no-var
  var __driveMigrationStore__: DriveMigrationStore | undefined;
  // eslint-disable-next-line no-var
  var __driveMigrationStoreMtime__: number | undefined;
  // eslint-disable-next-line no-var
  var __driveMigrationStats__: DriveMigrationStats | undefined;
  // eslint-disable-next-line no-var
  var __driveMigrationStatsMtime__: number | undefined;
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

export function getDriveMigrationTasks(clientId?: string): DriveMigrationTask[] {
  const tasks = loadStore().tasks;
  if (!clientId) return tasks;
  return tasks.filter((t) => t.clientId === clientId);
}

export function getDriveMigrationTask(id: string): DriveMigrationTask | undefined {
  return loadStore().tasks.find((t) => t.id === id);
}

export function createDriveMigrationTask(input: {
  name?: string;
  clientId?: string;
  sourceFolderUrl?: string;
  sourceFolderToken?: string;
  sourceFolderName?: string;
  targetWikiUrl: string;
  targetParentNodeToken?: string;
  items: MigrateItemParam[];
}): { task: DriveMigrationTask; isNew: boolean } {
  const store = loadStore();
  const currentTokens = new Set(input.items.map((i) => i.token));

  // 1. 检查是否存在正在运行或排队中且包含相同文档集合的任务（防止连击/并发重复创建）
  const activeTask = store.tasks.find((t) => {
    if (t.status !== "running" && t.status !== "pending") return false;
    const taskTokens = new Set(t.items.map((i) => i.token));

    // 如果任务文档集完全相同
    if (taskTokens.size === currentTokens.size && [...currentTokens].every((tk) => taskTokens.has(tk))) {
      return true;
    }

    // 如果是单文档迁移，且该文档已经在活跃任务中
    if (input.items.length === 1 && taskTokens.has(input.items[0].token)) {
      return true;
    }

    return false;
  });

  if (activeTask) {
    return { task: activeTask, isNew: false };
  }

  const id = `dmt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const currentTime = now();

  const taskItems: MigrationTaskItemDetail[] = input.items.map((item) => ({
    token: item.token,
    name: item.name,
    type: item.type,
    customTargetParentToken: item.customTargetParentToken,
    status: item.type === "folder" ? "skipped" : "pending",
    error: item.type === "folder" ? "文件夹暂不直接迁移" : undefined,
    isShortcut: item.isShortcut,
    targetToken: item.targetToken,
    shortcutToken: item.shortcutToken,
    targetType: item.targetType,
  }));

  const initialSkipped = taskItems.filter((i) => i.status === "skipped").length;

  const task: DriveMigrationTask = {
    id,
    name: input.name || `迁移任务 (${input.items.length} 篇文档)`,
    clientId: input.clientId,
    sourceFolderUrl: input.sourceFolderUrl,
    sourceFolderToken: input.sourceFolderToken,
    sourceFolderName: input.sourceFolderName,
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
  return { task, isNew: true };
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

export function clearCompletedDriveMigrationTasks(clientId?: string): void {
  const store = loadStore();
  store.tasks = store.tasks.filter((t) => {
    // 正在运行或排队中的任务始终保留
    if (t.status === "running" || t.status === "pending") return true;
    // 如果指定了 clientId，只清理该用户的已完成任务，保留其他人的
    if (clientId) {
      return t.clientId !== clientId;
    }
    // 未指定 clientId 时清理所有已完成任务
    return false;
  });
  persist(store);
}

function emptyStats(): DriveMigrationStats {
  return {
    totalFiles: 0,
    successFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    totalDrivesCount: 0,
    totalTargetWikisCount: 0,
    drives: {},
    targetWikis: {},
    records: [],
    updatedAt: now(),
  };
}

function persistStats(stats: DriveMigrationStats): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporary = `${STATS_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(stats, null, 2), "utf-8");
    fs.renameSync(temporary, STATS_FILE);
    global.__driveMigrationStats__ = stats;
    global.__driveMigrationStatsMtime__ = fs.statSync(STATS_FILE).mtimeMs;
  } catch (error) {
    console.error("写入个人网盘迁移统计记录失败:", error);
  }
}

function loadStatsStore(): DriveMigrationStats {
  try {
    if (!fs.existsSync(STATS_FILE)) {
      const stats = emptyStats();
      // 首次加载时自动从现有历史任务中补齐已完成的迁移数据
      const currentTasks = loadStore().tasks;
      const initialRecords: MigratedFileRecord[] = [];
      for (const t of currentTasks) {
        for (const item of t.items) {
          if (item.status === "success" || item.status === "failed") {
            initialRecords.push({
              fileToken: item.token,
              fileName: item.name,
              fileType: item.type,
              sourceDriveToken: t.sourceFolderToken || "default_personal_drive",
              sourceDriveUrl: t.sourceFolderUrl,
              sourceDriveName: t.sourceFolderName || "个人网盘",
              targetWikiUrl: t.targetWikiUrl,
              targetParentNodeToken: item.customTargetParentToken || t.targetParentNodeToken,
              wikiToken: item.wikiToken,
              wikiUrl: item.url,
              migratedAt: t.updatedAt || t.createdAt,
              status: item.status,
              error: item.error,
              taskId: t.id,
            });
          }
        }
      }
      if (initialRecords.length > 0) {
        return recordDriveMigrationStats(initialRecords);
      }
      return stats;
    }
    const mtime = fs.statSync(STATS_FILE).mtimeMs;
    if (global.__driveMigrationStats__ && global.__driveMigrationStatsMtime__ === mtime) {
      return global.__driveMigrationStats__;
    }
    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8")) as DriveMigrationStats;
    global.__driveMigrationStats__ = parsed;
    global.__driveMigrationStatsMtime__ = mtime;
    return parsed;
  } catch (error) {
    console.error("读取个人网盘迁移统计记录失败:", error);
    return emptyStats();
  }
}

export function getDriveMigrationStats(): DriveMigrationStats {
  return loadStatsStore();
}

export function recordDriveMigrationStats(newRecords: MigratedFileRecord[]): DriveMigrationStats {
  const stats = fs.existsSync(STATS_FILE) ? loadStatsStore() : emptyStats();

  for (const record of newRecords) {
    const existingIndex = stats.records.findIndex(
      (r) => r.fileToken === record.fileToken && r.taskId === record.taskId
    );

    if (existingIndex >= 0) {
      stats.records[existingIndex] = { ...stats.records[existingIndex], ...record };
    } else {
      stats.records.unshift(record);
    }
  }

  let totalFiles = 0;
  let successFiles = 0;
  let failedFiles = 0;
  let skippedFiles = 0;

  const drivesMap: Record<string, DriveFolderStat> = {};
  const wikisMap: Record<string, TargetWikiStat> = {};

  for (const r of stats.records) {
    totalFiles++;
    if (r.status === "success") successFiles++;
    else if (r.status === "failed") failedFiles++;
    else if (r.status === "skipped") skippedFiles++;

    const driveKey = r.sourceDriveToken || "default_personal_drive";
    if (!drivesMap[driveKey]) {
      drivesMap[driveKey] = {
        folderToken: driveKey,
        folderUrl: r.sourceDriveUrl,
        folderName: r.sourceDriveName || (driveKey === "default_personal_drive" ? "个人网盘" : `个人网盘 (${driveKey})`),
        totalMigratedFiles: 0,
        successCount: 0,
        failedCount: 0,
        lastMigratedAt: r.migratedAt,
        fileTokens: [],
      };
    }
    const dStat = drivesMap[driveKey];
    dStat.totalMigratedFiles++;
    if (r.status === "success") dStat.successCount++;
    else if (r.status === "failed") dStat.failedCount++;
    if (!dStat.fileTokens.includes(r.fileToken)) {
      dStat.fileTokens.push(r.fileToken);
    }
    if (new Date(r.migratedAt) > new Date(dStat.lastMigratedAt)) {
      dStat.lastMigratedAt = r.migratedAt;
    }

    const wikiKey = r.targetWikiUrl || "default_target_wiki";
    if (!wikisMap[wikiKey]) {
      wikisMap[wikiKey] = {
        targetWikiUrl: wikiKey,
        totalMigratedFiles: 0,
        successCount: 0,
        failedCount: 0,
        lastMigratedAt: r.migratedAt,
        fileTokens: [],
      };
    }
    const wStat = wikisMap[wikiKey];
    wStat.totalMigratedFiles++;
    if (r.status === "success") wStat.successCount++;
    else if (r.status === "failed") wStat.failedCount++;
    if (!wStat.fileTokens.includes(r.fileToken)) {
      wStat.fileTokens.push(r.fileToken);
    }
    if (new Date(r.migratedAt) > new Date(wStat.lastMigratedAt)) {
      wStat.lastMigratedAt = r.migratedAt;
    }
  }

  stats.totalFiles = totalFiles;
  stats.successFiles = successFiles;
  stats.failedFiles = failedFiles;
  stats.skippedFiles = skippedFiles;
  stats.drives = drivesMap;
  stats.targetWikis = wikisMap;
  stats.totalDrivesCount = Object.keys(drivesMap).length;
  stats.totalTargetWikisCount = Object.keys(wikisMap).length;
  stats.updatedAt = now();

  persistStats(stats);
  return stats;
}

