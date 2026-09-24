import "server-only";
import fs from "fs";
import path from "path";
import type { AIModelConfig } from "@/lib/ai-config/store";
import type {
  ItemFilters,
  KnowledgeDirectory,
  KnowledgeMigrationAuditLog,
  KnowledgeMigrationConfig,
  KnowledgeMigrationItem,
  KnowledgeMigrationJob,
  KnowledgeMigrationState,
  KnowledgeMigrationTask,
  KnowledgeTaskConfig,
  TaskMigrationStats,
  TaskNotifyConfig,
  WikiTreeNode,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "knowledge-migrations.json");

declare global {
  // eslint-disable-next-line no-var
  var __knowledgeMigrationStore__: KnowledgeMigrationState | undefined;
  // eslint-disable-next-line no-var
  var __knowledgeMigrationStoreMtime__: number | undefined;
}

function now() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function emptyState(): KnowledgeMigrationState {
  return {
    llmConfig: {},
    tasks: [],
  };
}

function isValidMigrationStore(store: unknown): store is KnowledgeMigrationState {
  return (
    Boolean(store) &&
    typeof store === "object" &&
    Array.isArray((store as KnowledgeMigrationState).tasks)
  );
}

function loadState(): KnowledgeMigrationState {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const mtime = fs.statSync(STORE_FILE).mtimeMs;
      if (
        isValidMigrationStore(global.__knowledgeMigrationStore__) &&
        global.__knowledgeMigrationStoreMtime__ === mtime
      ) {
        return global.__knowledgeMigrationStore__;
      }

      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as Partial<KnowledgeMigrationState>;
      
      // 判断是否已有新结构 tasks
      if (Array.isArray(parsed.tasks)) {
        for (const task of parsed.tasks) {
          if (!task || typeof task !== "object") continue;
          const map: Record<string, KnowledgeMigrationItem> = {};
          const rawItems = Array.isArray(task.items) ? task.items : Object.values(task.items || {});
          for (const it of rawItems) {
            if (!it || typeof it !== "object") continue;
            const wId = String(it.wikiId || it.source?.pageId || it.id);
            map[wId] = {
              ...it,
              id: wId,
              wikiId: wId,
              taskId: task.id,
              status: it.status || "discovered",
            };
          }
          task.items = map;
          if (!Array.isArray(task.jobs)) task.jobs = [];
          if (!Array.isArray(task.auditLogs)) task.auditLogs = [];
        }
        global.__knowledgeMigrationStoreMtime__ = mtime;
        global.__knowledgeMigrationStore__ = {
          llmConfig: parsed.llmConfig || {},
          tasks: parsed.tasks,
          activeTaskId: parsed.activeTaskId || parsed.tasks[0]?.id,
        };
        return global.__knowledgeMigrationStore__;
      }

      // 旧结构升级迁移：提取全局 LLM 配置并创建默认任务
      const oldConfig = (parsed as unknown as { config?: KnowledgeMigrationConfig }).config;
      const llmConfig: AIModelConfig = {
        llmBaseUrl: oldConfig?.llmBaseUrl,
        llmApiKey: oldConfig?.llmApiKey,
        llmModel: oldConfig?.llmModel,
        updatedAt: oldConfig?.updatedAt,
      };

      const defaultTaskId = "task_default";
      const itemsMap: Record<string, KnowledgeMigrationItem> = {};
      const oldItems = (parsed as unknown as { items?: KnowledgeMigrationItem[] }).items;
      if (Array.isArray(oldItems)) {
        for (const item of oldItems) {
          const wikiId = item.source?.pageId || item.id;
          itemsMap[wikiId] = {
            ...item,
            id: wikiId,
            wikiId,
            taskId: defaultTaskId,
          };
        }
      }

      const defaultTask: KnowledgeMigrationTask = {
        id: defaultTaskId,
        name: "默认归档任务",
        description: "历史导入任务",
        config: {
          confluenceBaseUrl: oldConfig?.confluenceBaseUrl || "https://wiki.segwayrobotics.com/pages/viewpage.action",
          confluenceRootPageId: oldConfig?.confluenceRootPageId || "109091428",
          confluenceAuthType: oldConfig?.confluenceAuthType || "pat",
          confluenceUsername: oldConfig?.confluenceUsername,
          confluenceSecret: oldConfig?.confluenceSecret,
          targetWikiRoot: oldConfig?.targetWikiRoot || "https://lcn9r6s394zz.feishu.cn/wiki/SFHOwfaJ8iC6Vzkm8ehcL5YYn2f",
          defaultOperatorName: oldConfig?.defaultOperatorName || "系统",
          updatedAt: oldConfig?.updatedAt,
        },
        targetDirectories: Array.isArray((parsed as unknown as { directoryTree?: KnowledgeDirectory[] }).directoryTree)
          ? ((parsed as unknown as { directoryTree?: KnowledgeDirectory[] }).directoryTree as KnowledgeDirectory[])
          : [],
        targetDirectoriesUpdatedAt: (parsed as unknown as { directoryUpdatedAt?: string }).directoryUpdatedAt,
        jobs: Array.isArray((parsed as unknown as { jobs?: KnowledgeMigrationJob[] }).jobs)
          ? ((parsed as unknown as { jobs?: KnowledgeMigrationJob[] }).jobs as KnowledgeMigrationJob[])
          : [],
        items: itemsMap,
        auditLogs: Array.isArray((parsed as unknown as { auditLogs?: KnowledgeMigrationAuditLog[] }).auditLogs)
          ? ((parsed as unknown as { auditLogs?: KnowledgeMigrationAuditLog[] }).auditLogs as KnowledgeMigrationAuditLog[])
          : [],
        createdAt: now(),
        updatedAt: now(),
      };

      global.__knowledgeMigrationStore__ = {
        llmConfig,
        tasks: [defaultTask],
        activeTaskId: defaultTaskId,
      };
      persist();
      return global.__knowledgeMigrationStore__;
    }
  } catch (error) {
    console.error("读取知识库迁移记录失败:", error);
  }
  const fallback = emptyState();
  global.__knowledgeMigrationStore__ = fallback;
  return fallback;
}

function persist() {
  const state = loadState();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tempFile, STORE_FILE);
  try {
    global.__knowledgeMigrationStoreMtime__ = fs.statSync(STORE_FILE).mtimeMs;
  } catch {
    // ignore
  }
}

// ----------------------------------------------------
// 全局模型配置 (LLM Config)
// ----------------------------------------------------

// ----------------------------------------------------
// 任务管理 (Tasks)
// ----------------------------------------------------

export function getTasks(): KnowledgeMigrationTask[] {
  const state = loadState();
  return Array.isArray(state.tasks) ? state.tasks : [];
}

export function getTask(taskId?: string): KnowledgeMigrationTask | undefined {
  const state = loadState();
  if (!Array.isArray(state.tasks)) {
    state.tasks = [];
    return undefined;
  }
  if (!taskId) {
    return state.tasks.find((t) => t.id === state.activeTaskId) || state.tasks[0];
  }
  return state.tasks.find((t) => t.id === taskId);
}

export function setActiveTask(taskId: string) {
  const state = loadState();
  state.activeTaskId = taskId;
  persist();
}

export function createTask(input: {
  name: string;
  description?: string;
  config: KnowledgeTaskConfig;
}): KnowledgeMigrationTask {
  const state = loadState();
  if (!Array.isArray(state.tasks)) {
    state.tasks = [];
  }
  const timestamp = now();
  const task: KnowledgeMigrationTask = {
    id: newId("task"),
    name: input.name.trim() || "未命名归档任务",
    description: input.description?.trim(),
    config: {
      ...input.config,
      updatedAt: timestamp,
    },
    jobs: [],
    items: {},
    auditLogs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.tasks.unshift(task);
  state.activeTaskId = task.id;
  persist();
  return task;
}

export function updateTask(
  taskId: string,
  changes: {
    name?: string;
    description?: string;
    config?: Partial<KnowledgeTaskConfig>;
  }
): KnowledgeMigrationTask | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  if (changes.name !== undefined) task.name = changes.name.trim();
  if (changes.description !== undefined) task.description = changes.description.trim();
  if (changes.config) {
    const prevConfig = task.config;
    task.config = {
      ...prevConfig,
      ...changes.config,
      confluenceSecret:
        changes.config.confluenceSecret !== undefined && changes.config.confluenceSecret.trim() !== ""
          ? changes.config.confluenceSecret
          : prevConfig.confluenceSecret,
      updatedAt: now(),
    };
    if (changes.config.targetWikiRoot && changes.config.targetWikiRoot !== prevConfig.targetWikiRoot) {
      task.targetDirectories = [];
      task.targetDirectoriesUpdatedAt = undefined;
    }
  }
  task.updatedAt = now();
  persist();
  return task;
}

export function deleteTask(taskId: string): boolean {
  const state = loadState();
  if (!Array.isArray(state.tasks)) {
    state.tasks = [];
    return false;
  }
  const index = state.tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return false;
  state.tasks.splice(index, 1);
  if (state.activeTaskId === taskId) {
    state.activeTaskId = state.tasks[0]?.id;
  }
  persist();
  return true;
}

export function getPublicTaskConfig(task: KnowledgeMigrationTask) {
  const { confluenceSecret, ...rest } = task.config;
  return {
    ...rest,
    confluenceSecretConfigured: Boolean(confluenceSecret && confluenceSecret.trim()),
  };
}

// ----------------------------------------------------
// 目录树与目标分类 (Task Tree & Target Directories)
// ----------------------------------------------------

export function saveTaskTree(taskId: string, tree: WikiTreeNode[]) {
  const task = getTask(taskId);
  if (!task) return;
  task.tree = tree;
  task.treeUpdatedAt = now();
  persist();
}

export function saveTaskTargetDirectories(taskId: string, directories: KnowledgeDirectory[]) {
  const task = getTask(taskId);
  if (!task) return;
  task.targetDirectories = directories;
  task.targetDirectoriesUpdatedAt = now();
  persist();
}

export function saveTaskMigrationStats(taskId: string, stats: TaskMigrationStats) {
  const task = getTask(taskId);
  if (!task) return;
  task.stats = stats;
  task.statsUpdatedAt = now();
  persist();
}

export function getTaskMigrationStats(taskId: string): TaskMigrationStats | undefined {
  const task = getTask(taskId);
  return task?.stats;
}

export function saveTaskNotifyConfig(taskId: string, notifyConfig: TaskNotifyConfig): TaskNotifyConfig | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  task.notifyConfig = {
    ...notifyConfig,
    webhookUrl: notifyConfig.webhookUrl?.trim() || "",
  };
  task.updatedAt = now();
  persist();
  return task.notifyConfig;
}

export function getTaskNotifyConfig(taskId: string): TaskNotifyConfig | undefined {
  const task = getTask(taskId);
  return task?.notifyConfig;
}

// ----------------------------------------------------
// 按 Wiki 唯一 ID 操作文档与状态 (Task Items by WikiId)
// ----------------------------------------------------

function collectSubtreeIds(node: WikiTreeNode): string[] {
  const ids: string[] = [String(node.id)];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      ids.push(...collectSubtreeIds(child));
    }
  }
  return ids;
}

function collectFolderIds(nodes: WikiTreeNode[] | undefined, set: Set<string>) {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      set.add(String(node.id));
      collectFolderIds(node.children, set);
    }
  }
}

function findNodeInTree(nodes: WikiTreeNode[] | undefined, targetId: string): WikiTreeNode | undefined {
  if (!nodes) return undefined;
  for (const node of nodes) {
    if (String(node.id) === String(targetId)) return node;
    const found = findNodeInTree(node.children, targetId);
    if (found) return found;
  }
  return undefined;
}

export function getTaskSubtreeWikiIds(taskId: string, rootWikiId?: string): string[] {
  const task = getTask(taskId);
  if (!task) return [];
  if (!rootWikiId || rootWikiId === "all") {
    if (task.tree && task.tree.length > 0) {
      const ids: string[] = [];
      for (const root of task.tree) {
        ids.push(...collectSubtreeIds(root));
      }
      return [...new Set(ids)];
    }
    return Object.keys(task.items || {});
  }
  const selectedNode = findNodeInTree(task.tree, String(rootWikiId));
  if (selectedNode) {
    return [...new Set(collectSubtreeIds(selectedNode))];
  }
  return [String(rootWikiId)];
}

export function getTaskItems(taskId: string, filters: ItemFilters = {}): KnowledgeMigrationItem[] {
  const task = getTask(taskId);
  if (!task) return [];

  let items = Array.isArray(task.items)
    ? (task.items as KnowledgeMigrationItem[])
    : Object.values(task.items || {});

  // 1. 如果指定了选中的树节点：包含该节点自身以及其下级所有子文档
  if (filters.selectedWikiId && filters.selectedWikiId !== "all") {
    const selectedNode = findNodeInTree(task.tree, String(filters.selectedWikiId));
    if (selectedNode) {
      const subtreeIds = collectSubtreeIds(selectedNode);
      const allowedIds = new Set(subtreeIds);
      items = items.filter((item) => allowedIds.has(String(item.wikiId || item.id)));
    } else {
      items = items.filter((item) => String(item.wikiId || item.id) === String(filters.selectedWikiId));
    }
  }

  // 2. 根据 tab 快速切分
  if (filters.tab === "pending") {
    items = items.filter((item) => ["discovered", "pending_review", "approved"].includes(item.status));
  } else if (filters.tab === "migrated") {
    items = items.filter((item) => item.status === "migrated");
  } else if (filters.tab === "failed") {
    items = items.filter((item) => ["failed", "skipped"].includes(item.status));
  }

  // 3. 详细字段过滤
  const keyword = filters.keyword?.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.wikiId && item.wikiId !== filters.wikiId) return false;
    if (
      filters.primaryCategory &&
      item.finalPrimaryCategory !== filters.primaryCategory &&
      item.suggestion?.primaryCategory !== filters.primaryCategory
    )
      return false;
    if (
      filters.secondaryCategory &&
      item.finalSecondaryCategory !== filters.secondaryCategory &&
      item.suggestion?.secondaryCategory !== filters.secondaryCategory
    )
      return false;
    if (filters.createdBy && item.source?.createdBy !== filters.createdBy) return false;
    if (filters.updatedBy && item.source?.updatedBy !== filters.updatedBy) return false;
    if (filters.approvedBy && item.approvedBy !== filters.approvedBy) return false;
    if (filters.jobId && item.jobId !== filters.jobId) return false;
    if (keyword) {
      const pathStr = Array.isArray(item.source?.path) ? item.source.path.join(" / ") : "";
      const textToSearch = [
        item.wikiId || "",
        item.source?.title || "",
        item.finalTitle || "",
        pathStr,
      ]
        .join(" ")
        .toLowerCase();
      if (!textToSearch.includes(keyword)) return false;
    }
    return true;
  });

  // 4. 统计树中的目录节点
  const folderIds = new Set<string>();
  collectFolderIds(task.tree, folderIds);

  // 5. 组装附加属性（是否为目录文档、是否为当前选中目录根、正文是否为空）
  const decorated = filtered.map((item) => {
    const wikiId = String(item.wikiId || item.id);
    const isFolder = folderIds.has(wikiId);
    const isCurrentRoot =
      Boolean(filters.selectedWikiId && filters.selectedWikiId !== "all") &&
      wikiId === String(filters.selectedWikiId);
    const contentEmpty = item.source?.contentEmpty;
    return {
      ...item,
      isFolder,
      isCurrentRoot,
      contentEmpty,
    };
  });

  // 6. 如果选中国了特定目录节点，将该目录节点自身置于表格第 1 位 (index 0)
  if (filters.selectedWikiId && filters.selectedWikiId !== "all") {
    const targetId = String(filters.selectedWikiId);
    decorated.sort((a, b) => {
      const aIsTarget = String(a.wikiId || a.id) === targetId ? 1 : 0;
      const bIsTarget = String(b.wikiId || b.id) === targetId ? 1 : 0;
      return bIsTarget - aIsTarget;
    });
  }

  return decorated;
}

export function getTaskItem(taskId: string, wikiId: string): KnowledgeMigrationItem | undefined {
  const task = getTask(taskId);
  if (!task || !task.items) return undefined;
  if (Array.isArray(task.items)) {
    return (task.items as KnowledgeMigrationItem[]).find(
      (i) => String(i.wikiId) === String(wikiId) || String(i.id) === String(wikiId)
    );
  }
  return (
    task.items[wikiId] ||
    Object.values(task.items).find(
      (i) => String(i?.wikiId) === String(wikiId) || String(i?.id) === String(wikiId)
    )
  );
}

export function upsertTaskScannedItem(
  taskId: string,
  input: Omit<KnowledgeMigrationItem, "id" | "createdAt" | "updatedAt" | "retryCount">
): KnowledgeMigrationItem {
  const task = getTask(taskId);
  if (!task) throw new Error("未找到任务");

  if (!task.items || Array.isArray(task.items)) {
    const oldItems = Array.isArray(task.items) ? (task.items as KnowledgeMigrationItem[]) : [];
    task.items = {};
    oldItems.forEach((i) => {
      task.items[i.wikiId || i.id] = i;
    });
  }

  const wikiId = input.wikiId || input.source.pageId;
  const current = task.items[wikiId];
  const timestamp = now();

  if (current) {
    // 若已迁移且内容哈希无变化，直接保持迁移状态
    if (current.status === "migrated" && current.source.contentHash === input.source.contentHash) {
      return current;
    }

    // 若来源更新，退回待审核
    Object.assign(current, input, {
      id: wikiId,
      wikiId,
      taskId,
      status: current.status === "migrated" ? "pending_review" : (current.status || "pending_review"),
      finalTitle: current.finalTitle || input.source.title,
      targetNodeToken: current.status === "migrated" ? undefined : current.targetNodeToken,
      targetDocumentToken: current.status === "migrated" ? undefined : current.targetDocumentToken,
      targetUrl: current.status === "migrated" ? undefined : current.targetUrl,
      migratedAt: current.status === "migrated" ? undefined : current.migratedAt,
      approvedBy: current.status === "migrated" ? undefined : current.approvedBy,
      approvedAt: current.status === "migrated" ? undefined : current.approvedAt,
      error: current.status === "migrated" ? "来源文档发生内容更新，需重新确认" : undefined,
      updatedAt: timestamp,
    });
    persist();
    return current;
  }

  const item: KnowledgeMigrationItem = {
    ...input,
    id: wikiId,
    wikiId,
    taskId,
    retryCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  task.items[wikiId] = item;
  persist();
  return item;
}

export function updateTaskItem(
  taskId: string,
  wikiId: string,
  changes: Partial<KnowledgeMigrationItem>
): KnowledgeMigrationItem | undefined {
  const item = getTaskItem(taskId, wikiId);
  if (!item) return undefined;
  Object.assign(item, changes, { updatedAt: now() });
  persist();
  return item;
}

// ----------------------------------------------------
// 任务批处理与审计日志 (Task Jobs & Audits)
// ----------------------------------------------------

export function createTaskJob(taskId: string): KnowledgeMigrationJob {
  const task = getTask(taskId);
  if (!task) throw new Error("未找到任务");
  if (!Array.isArray(task.jobs)) {
    task.jobs = [];
  }
  const job: KnowledgeMigrationJob = {
    id: newId("job"),
    status: "running",
    total: 0,
    processed: 0,
    failed: 0,
    startedAt: now(),
  };
  task.jobs.unshift(job);
  addTaskAuditLog(taskId, { action: "scan_started", detail: `开始扫描任务批次 ${job.id}` });
  persist();
  return job;
}

export function updateTaskJob(taskId: string, jobId: string, changes: Partial<KnowledgeMigrationJob>) {
  const task = getTask(taskId);
  if (!task) return undefined;
  if (!Array.isArray(task.jobs)) {
    task.jobs = [];
    return undefined;
  }
  const job = task.jobs.find((j) => j.id === jobId);
  if (!job) return undefined;
  Object.assign(job, changes);
  persist();
  return job;
}

export function addTaskAuditLog(taskId: string, input: Omit<KnowledgeMigrationAuditLog, "id" | "createdAt">) {
  const task = getTask(taskId);
  if (!task) return undefined;
  if (!Array.isArray(task.auditLogs)) {
    task.auditLogs = [];
  }
  const log: KnowledgeMigrationAuditLog = { ...input, id: newId("audit"), createdAt: now() };
  task.auditLogs.unshift(log);
  if (task.auditLogs.length > 10000) task.auditLogs.splice(10000);
  return log;
}

export function persistMigrationState() {
  persist();
}

// ----------------------------------------------------
// 兼容性接口封装（保留老代码与默认任务对接）
// ----------------------------------------------------

export function getMigrationConfig(): KnowledgeMigrationConfig | undefined {
  const task = getTask();
  if (!task) return undefined;
  return task.config;
}

export function saveMigrationConfig(config: KnowledgeMigrationConfig): KnowledgeMigrationConfig {
  const task = getTask();
  if (!task) throw new Error("未找到默认任务");
  updateTask(task.id, {
    config: {
      confluenceBaseUrl: config.confluenceBaseUrl,
      confluenceRootPageId: config.confluenceRootPageId,
      confluenceAuthType: config.confluenceAuthType,
      confluenceUsername: config.confluenceUsername,
      confluenceSecret: config.confluenceSecret,
      targetWikiRoot: config.targetWikiRoot,
      defaultOperatorName: config.defaultOperatorName,
    },
  });
  return getMigrationConfig()!;
}

export function getPublicMigrationConfig() {
  const task = getTask();
  if (!task) return undefined;
  const publicTask = getPublicTaskConfig(task);
  return {
    ...publicTask,
  };
}

export function getKnowledgeDirectories(): KnowledgeDirectory[] {
  const task = getTask();
  return task?.targetDirectories ?? [];
}

export function saveKnowledgeDirectories(directories: KnowledgeDirectory[]) {
  const task = getTask();
  if (task) saveTaskTargetDirectories(task.id, directories);
}

export function createJob(): KnowledgeMigrationJob {
  const task = getTask();
  if (!task) throw new Error("未找到任务");
  return createTaskJob(task.id);
}

export function getJobs() {
  const task = getTask();
  return task?.jobs ?? [];
}

export function updateJob(jobId: string, changes: Partial<KnowledgeMigrationJob>) {
  const task = getTask();
  if (!task) return undefined;
  return updateTaskJob(task.id, jobId, changes);
}

export function upsertScannedItem(
  input: Omit<KnowledgeMigrationItem, "id" | "createdAt" | "updatedAt" | "retryCount">
): KnowledgeMigrationItem {
  const task = getTask();
  if (!task) throw new Error("未找到任务");
  return upsertTaskScannedItem(task.id, input);
}

export function getMigrationItems(filters: ItemFilters = {}) {
  const task = getTask();
  if (!task) return [];
  return getTaskItems(task.id, filters);
}

export function getMigrationItem(id: string) {
  const task = getTask();
  if (!task) return undefined;
  return getTaskItem(task.id, id);
}

export function updateMigrationItem(id: string, changes: Partial<KnowledgeMigrationItem>) {
  const task = getTask();
  if (!task) return undefined;
  return updateTaskItem(task.id, id, changes);
}

export function addAuditLog(input: Omit<KnowledgeMigrationAuditLog, "id" | "createdAt">) {
  const task = getTask();
  if (!task) return undefined;
  return addTaskAuditLog(task.id, input);
}
