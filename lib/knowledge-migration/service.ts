import "server-only";
import pLimit from "p-limit";
import { updateDocumentContent } from "@/lib/mcp/feishu-doc-engine";
import { classifyDocument } from "./classifier";
import { buildWikiTree, fetchWikiHierarchy, getPage, isContentEmpty, listDescendantPages, refreshWikiTreeProgress, storageXhtmlToMarkdown, toSourceDocument } from "./confluence";
import { createMigratedWikiDocument, loadWikiDestination, checkWikiNodeExists, type FeishuDocNode, type WikiDestination } from "./feishu";
import {
  addTaskAuditLog,
  createTaskJob,
  getLLMConfig,
  getTask,
  getTaskItem,
  getTaskItems,
  getTaskSubtreeWikiIds,
  getTasks,
  persistMigrationState,
  saveTaskTargetDirectories,
  saveTaskTree,
  updateTaskItem,
  updateTaskJob,
  upsertTaskScannedItem,
  // 兼容性接口
  addAuditLog,
  createJob,
  getJobs,
  getKnowledgeDirectories,
  getMigrationConfig,
  getMigrationItem,
  getMigrationItems,
  saveKnowledgeDirectories,
  updateJob,
  updateMigrationItem,
  upsertScannedItem,
} from "./store";
import {
  isValidCategory,
  type DynamicTaxonomy,
  type KnowledgeDirectory,
  type KnowledgeMigrationItem,
  type KnowledgeMigrationTask,
  type MigrationStatus,
  type PrimaryCategory,
  type SecondaryCategory,
  type WikiTreeNode,
} from "./types";

function requireTask(taskId?: string): KnowledgeMigrationTask {
  const task = getTask(taskId);
  if (!task) throw new Error("未找到指定的知识库归档任务");
  if (!task.config.confluenceBaseUrl || !task.config.confluenceRootPageId || !task.config.targetWikiRoot) {
    throw new Error("请先完整填写 Confluence 来源地址、根页面 ID 以及目标飞书知识库根节点");
  }
  return task;
}

export function getTaskOverview(taskId: string) {
  const items = getTaskItems(taskId);
  const counts = items.reduce<Record<MigrationStatus, number>>(
    (acc, item) => {
      const st = item?.status || "discovered";
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    },
    { discovered: 0, pending_review: 0, approved: 0, migrating: 0, migrated: 0, failed: 0, skipped: 0 }
  );
  const task = getTask(taskId);
  return { jobs: task?.jobs || [], counts, total: items.length };
}

/**
 * 快速同步源 Wiki 目录树（从 Confluence 获取）
 * 1. 读取 Confluence 页面树与元数据；
 * 2. 注册新发现的 Wiki 页面为文档项（按 wikiId 记录），并更新现有项的内容为空状态；
 * 3. 重新构建左侧目录树并持久化。
 */
export async function syncTaskWikiTree(taskId: string): Promise<{ tree: WikiTreeNode[]; overview: ReturnType<typeof getTaskOverview> }> {
  const task = requireTask(taskId);

  // 1. 读取 Confluence 页面树结构
  const { roots, allPages } = await fetchWikiHierarchy(task.config, task.items);

  // 2. 注册新发现的 Wiki 页面为文档项（按 wikiId 记录），并更新现有项的内容为空状态
  for (const page of allPages) {
    const source = toSourceDocument(task.config, page);
    if (!task.items[page.id]) {
      upsertTaskScannedItem(taskId, {
        wikiId: page.id,
        taskId,
        source,
        suggestion: {},
        finalTitle: page.title,
        status: "discovered",
      });
    } else {
      const existing = task.items[page.id];
      if (existing?.source) {
        existing.source.contentEmpty = source.contentEmpty;
        existing.source.contentLength = source.contentLength;
      }
    }
  }

  // 3. 用更新后的 items 重新计算树统计与状态
  const updatedTask = getTask(taskId)!;
  const refreshedTree = buildWikiTree(
    (roots || []).map((r) => ({ id: r.id, title: r.title })),
    (allPages || []).filter((p) => !(roots || []).some((r) => r.id === p.id)),
    task.config.confluenceBaseUrl,
    updatedTask.items
  );
  saveTaskTree(taskId, refreshedTree);

  addTaskAuditLog(taskId, { action: "tree_synced", detail: `已同步 Wiki 目录树，共扫描 ${allPages.length} 篇页面节点` });
  persistMigrationState();

  return {
    tree: refreshedTree,
    overview: getTaskOverview(taskId),
  };
}

/**
 * 兼容性保留别名
 */
export const syncTaskTree = syncTaskWikiTree;

/**
 * 从飞书目标知识库获取一级/二级分类目录，并对齐飞书端文档状态
 * 1. 深度扫描目标飞书目录，获取一级与二级分类；
 * 2. 双向对齐状态（探测飞书端物理删除、自动绑定中断遗留文档）；
 * 3. 持久化目标目录与分类体系。
 */
export async function syncTaskTargetDirectories(taskId: string): Promise<{
  targetDirectories: KnowledgeDirectory[];
  taxonomy: DynamicTaxonomy;
  overview: ReturnType<typeof getTaskOverview>;
}> {
  const task = requireTask(taskId);

  // 1. 同步飞书目标目录与全量现有文档
  const destination = await loadWikiDestination(task.config, { fetchExistingDocs: true });
  saveTaskTargetDirectories(taskId, destination.directories);

  // 2. 双向对齐飞书知识库状态
  let resetDeletedCount = 0;
  let alignedExistingCount = 0;

  for (const wikiId of Object.keys(task.items)) {
    const item = task.items[wikiId];
    if (!item) continue;

    // 2.1 检测飞书端已删除（本地标记 migrated，但在飞书目标知识库中已被物理删除）
    if (item.status === "migrated") {
      const token = item.targetNodeToken;
      const existsInCache = token && destination.existingNodesByToken?.has(token);
      if (!existsInCache) {
        let isAlive = false;
        if (token) {
          const liveNode = await checkWikiNodeExists(destination.spaceId, token);
          if (liveNode) {
            isAlive = true;
            destination.existingNodesByToken?.set(token, liveNode);
          }
        }

        if (!isAlive) {
          // 飞书端已被删除，自动重置状态为 pending_review，清空失效 token 与访问地址
          item.status = "pending_review";
          item.targetNodeToken = undefined;
          item.targetDocumentToken = undefined;
          item.targetUrl = undefined;
          item.migratedAt = undefined;
          item.error = "检测到飞书端对应文档已被删除，已自动重置为待迁移状态";
          item.updatedAt = new Date().toISOString();
          resetDeletedCount++;
          addTaskAuditLog(taskId, {
            wikiId: item.wikiId,
            action: "item_updated",
            detail: `检测到飞书目标文档（Token: ${token || "未知"}）在知识库中已被删除，已自动重置为待迁移`,
          });
        }
      }
    }

    // 2.2 检测服务中断/重试导致飞书端已创建但本地未对齐的文档（防止重复迁移）
    if (item.status !== "migrated" && item.status !== "skipped") {
      let matchedFeishuNode: FeishuDocNode | undefined;

      // 优先根据历史 targetNodeToken 匹配
      if (item.targetNodeToken && destination.existingNodesByToken?.has(item.targetNodeToken)) {
        matchedFeishuNode = destination.existingNodesByToken.get(item.targetNodeToken);
      } else {
        // 根据目标分类目录与文档标题匹配
        const primary = item.finalPrimaryCategory || item.suggestion?.primaryCategory;
        const secondary = item.finalSecondaryCategory || item.suggestion?.secondaryCategory;
        if (primary && secondary) {
          const parentToken = destination.folders.get(`${primary}/${secondary}`);
          if (parentToken) {
            const targetTitle = (item.finalTitle || item.source.title || "").trim();
            matchedFeishuNode = destination.existingNodesByParentAndTitle?.get(`${parentToken}:::${targetTitle}`);
          }
        }
      }

      if (matchedFeishuNode) {
        item.targetNodeToken = matchedFeishuNode.nodeToken;
        item.targetDocumentToken = matchedFeishuNode.documentToken;
        item.targetUrl = matchedFeishuNode.url;
        item.migratedAt = item.migratedAt || new Date().toISOString();
        item.status = "migrated";
        item.error = undefined;
        item.updatedAt = new Date().toISOString();
        alignedExistingCount++;
        addTaskAuditLog(taskId, {
          wikiId: item.wikiId,
          action: "migration_succeeded",
          detail: `已自动对齐目标飞书知识库现有文档「${matchedFeishuNode.title}」（Token: ${matchedFeishuNode.nodeToken}），避免重复迁移`,
        });
      }
    }
  }

  // 若存在已有树且有状态变化，更新树的统计进度
  if (task.tree && (resetDeletedCount > 0 || alignedExistingCount > 0)) {
    task.tree = refreshWikiTreeProgress(task.tree, task.items);
  }

  const alignDetail = (resetDeletedCount > 0 || alignedExistingCount > 0)
    ? `；飞书状态已对齐（重置已删除 ${resetDeletedCount} 篇，关联已有 ${alignedExistingCount} 篇）`
    : "";
  addTaskAuditLog(taskId, {
    action: "target_directories_synced",
    detail: `已同步飞书目标目录，共获取 ${destination.directories.length} 个一级分类${alignDetail}`,
  });
  persistMigrationState();

  return {
    targetDirectories: destination.directories,
    taxonomy: destination.taxonomy,
    overview: getTaskOverview(taskId),
  };
}

async function scanOneTaskPage(
  taskId: string,
  jobId: string,
  pageId: string,
  taxonomy: DynamicTaxonomy
) {
  const task = requireTask(taskId);
  const page = await getPage(task.config, pageId);
  const markdown = storageXhtmlToMarkdown(page.body?.storage?.value || "");
  const source = toSourceDocument(task.config, page, markdown);
  const empty = isContentEmpty(markdown) || isContentEmpty(page.body?.storage?.value);
  source.contentEmpty = empty;

  // 如果文件夹或文档的正文为空，则不进行大模型扫描分类
  if (empty) {
    upsertTaskScannedItem(taskId, {
      wikiId: page.id,
      taskId,
      jobId,
      source,
      suggestion: {
        reason: "正文为空，已跳过大模型分类",
        summary: "正文为空（目录节点）",
      },
      finalTitle: source.title,
      status: "discovered",
    });
    return;
  }

  const llmConfig = getLLMConfig();
  const suggestion = await classifyDocument(llmConfig, source, markdown, taxonomy);

  upsertTaskScannedItem(taskId, {
    wikiId: page.id,
    taskId,
    jobId,
    source,
    suggestion,
    finalTitle: source.title,
    finalPrimaryCategory: suggestion.primaryCategory,
    finalSecondaryCategory: suggestion.secondaryCategory,
    status: "pending_review",
    error: suggestion.error,
  });
}

async function executeTaskScan(
  taskId: string,
  jobId: string,
  taxonomy: DynamicTaxonomy,
  selectedWikiId?: string
) {
  try {
    const task = requireTask(taskId);
    let targetWikiIds = getTaskSubtreeWikiIds(taskId, selectedWikiId);

    // 若本地树尚未初始化，则兜底通过接口拉取
    if (!targetWikiIds.length) {
      const pages = await listDescendantPages(task.config);
      targetWikiIds = pages.map((p) => p.id);
    }

    updateTaskJob(taskId, jobId, { total: targetWikiIds.length });
    const limit = pLimit(4);

    const nodeTitle = selectedWikiId
      ? (getTaskItem(taskId, selectedWikiId)?.source?.title || selectedWikiId)
      : undefined;

    addTaskAuditLog(taskId, {
      action: "scan_started",
      detail: selectedWikiId
        ? `开始扫描目录「${nodeTitle}」维度下的 ${targetWikiIds.length} 篇页面并调用大模型分类`
        : `开始全量扫描 ${targetWikiIds.length} 篇页面并调用大模型分类`,
    });

    await Promise.all(
      targetWikiIds.map((wikiId) =>
        limit(async () => {
          try {
            await scanOneTaskPage(taskId, jobId, wikiId, taxonomy);
            const currentTask = getTask(taskId);
            const job = currentTask?.jobs.find((j) => j.id === jobId);
            if (job) updateTaskJob(taskId, jobId, { processed: job.processed + 1 });
          } catch (error) {
            const currentTask = getTask(taskId);
            const job = currentTask?.jobs.find((j) => j.id === jobId);
            if (job) updateTaskJob(taskId, jobId, { processed: job.processed + 1, failed: job.failed + 1 });
            addTaskAuditLog(taskId, {
              action: "migration_failed",
              wikiId,
              detail: `扫描来源页面 ${wikiId} 失败：${error instanceof Error ? error.message : "未知错误"}`,
            });
            persistMigrationState();
          }
        })
      )
    );

    const currentTask = getTask(taskId);
    const job = currentTask?.jobs.find((j) => j.id === jobId);
    updateTaskJob(taskId, jobId, {
      status: job?.failed ? "completed_with_errors" : "completed",
      finishedAt: new Date().toISOString(),
    });
    addTaskAuditLog(taskId, {
      action: "scan_completed",
      detail: selectedWikiId
        ? `目录「${nodeTitle}」扫描任务批次 ${jobId} 已完成（共 ${targetWikiIds.length} 篇）`
        : `全量扫描任务批次 ${jobId} 已完成（共 ${targetWikiIds.length} 篇）`,
    });

    // 扫描后重新同步并刷新树状态与统计计数
    void syncTaskTree(taskId).catch(() => undefined);
    persistMigrationState();
  } catch (error) {
    updateTaskJob(taskId, jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : "扫描失败",
      finishedAt: new Date().toISOString(),
    });
    addTaskAuditLog(taskId, {
      action: "migration_failed",
      detail: `扫描任务 ${jobId} 失败：${error instanceof Error ? error.message : "未知错误"}`,
    });
    persistMigrationState();
  }
}

export async function startTaskScan(taskId: string, options?: { selectedWikiId?: string }) {
  const task = requireTask(taskId);
  if (task.jobs.some((job) => job.status === "running")) {
    throw new Error("当前任务已有扫描任务正在运行，请等待完成后再试");
  }

  // 先读取飞书知识库目录，确保目标路径有效
  const destination = await loadWikiDestination(task.config);
  saveTaskTargetDirectories(taskId, destination.directories);

  const selectedWikiId =
    options?.selectedWikiId && options.selectedWikiId !== "all"
      ? options.selectedWikiId
      : undefined;

  const job = createTaskJob(taskId);
  void executeTaskScan(taskId, job.id, destination.taxonomy, selectedWikiId);
  return job;
}

export function reviewTaskItem(
  taskId: string,
  input: {
    wikiId: string;
    title?: string;
    primaryCategory?: string;
    secondaryCategory?: string;
    action?: "save" | "skip" | "reset";
    operator?: string;
  }
) {
  const task = requireTask(taskId);
  const item = getTaskItem(taskId, input.wikiId);
  if (!item) throw new Error(`未找到 Wiki ID 为 ${input.wikiId} 的迁移文档`);

  const action = input.action || "save";
  const operator = input.operator?.trim() || task.config.defaultOperatorName?.trim() || undefined;

  if (action === "reset") {
    if (item.status === "migrating") throw new Error("文档正在迁移中，暂时不能重置");
    const result = updateTaskItem(taskId, item.wikiId, {
      status: "pending_review",
      approvedBy: undefined,
      approvedAt: undefined,
      migratedAt: undefined,
      targetNodeToken: undefined,
      targetDocumentToken: undefined,
      targetUrl: undefined,
      error: undefined,
      retryCount: 0,
    });
    addTaskAuditLog(taskId, {
      wikiId: item.wikiId,
      action: "item_updated",
      operator,
      detail: "重置迁移记录，重新进入待迁移",
    });
    persistMigrationState();
    return result;
  }

  const title = input.title?.trim() || item.finalTitle;
  const primary = input.primaryCategory || item.finalPrimaryCategory;
  const secondary = input.secondaryCategory || item.finalSecondaryCategory;

  if (action === "skip") {
    if (["migrating", "migrated"].includes(item.status)) {
      throw new Error("文档已开始或完成迁移，不能再忽略");
    }
    const result = updateTaskItem(taskId, item.wikiId, { status: "skipped", error: undefined });
    addTaskAuditLog(taskId, { wikiId: item.wikiId, action: "skipped", operator, detail: "忽略该文档迁移" });
    persistMigrationState();
    return result;
  }

  const changes: Partial<KnowledgeMigrationItem> = {
    finalTitle: title,
    finalPrimaryCategory: primary as PrimaryCategory | undefined,
    finalSecondaryCategory: secondary as SecondaryCategory | undefined,
    error: undefined,
  };

  // 修改已迁移文档的标题或目标目录后，旧目标已经不再代表当前配置。
  // 退回待迁移并清理旧目标信息，下一次发布才会严格使用最新 final* 字段。
  if (action === "save" && item.status === "migrated") {
    Object.assign(changes, {
      status: "pending_review" as const,
      approvedBy: undefined,
      approvedAt: undefined,
      migratedAt: undefined,
      targetNodeToken: undefined,
      targetDocumentToken: undefined,
      targetUrl: undefined,
    });
  }

  if (action === "save" && item.status === "skipped") {
    changes.status = "pending_review";
  }

  const result = updateTaskItem(taskId, item.wikiId, changes);
  addTaskAuditLog(taskId, {
    wikiId: item.wikiId,
    action: "item_updated",
    operator,
    detail: "更新迁移配置信息",
  });
  persistMigrationState();
  return result;
}

function formatTime(value?: string) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Shanghai",
        hour12: false,
      }).format(new Date(value))
    : "未知";
}

function provenanceMarkdown(item: KnowledgeMigrationItem, operator?: string) {
  const archivedBy = operator?.trim() || item.approvedBy?.trim();
  return [
    "> 📌 文档迁移溯源信息",
    `> Wiki 唯一 ID：${item.wikiId}`,
    `> 来源文档：${item.source.title}（${item.source.url}）`,
    `> 原作者：${item.source.createdBy || "未知"} ｜ 创建时间：${formatTime(item.source.createdAt)}`,
    `> 最后更新人：${item.source.updatedBy || "未知"} ｜ 更新时间：${formatTime(item.source.updatedAt)}`,
    ...(archivedBy && archivedBy !== "未填写"
      ? [`> 归档人：${archivedBy}`]
      : []),
    "",
    "---",
    "",
  ].join("\n");
}

async function publishOneTaskItem(
  taskId: string,
  item: KnowledgeMigrationItem,
  destination: WikiDestination,
  options?: { parentNodeToken?: string; allowSourceUpdate?: boolean }
) {
  const task = requireTask(taskId);
  const operator = task.config.defaultOperatorName?.trim() || item.approvedBy?.trim() || undefined;
  if (!item.finalPrimaryCategory) throw new Error("迁移路径未确认，请选择一级目录");
  if (!isValidCategory(item.finalPrimaryCategory, item.finalSecondaryCategory, destination.taxonomy)) {
    throw new Error("目标飞书目录结构已变化，请重新选择迁移路径");
  }

  updateTaskItem(taskId, item.wikiId, { status: "migrating", error: undefined });
  addTaskAuditLog(taskId, { wikiId: item.wikiId, action: "migration_started", operator, detail: "开始创建飞书新文档" });

  try {
    const page = await getPage(task.config, item.source.pageId);
    const markdown = storageXhtmlToMarkdown(page.body?.storage?.value || "");
    const latestSource = toSourceDocument(task.config, page, markdown);

    if (
      item.source.contentHash &&
      item.source.contentHash !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" &&
      latestSource.contentHash !== item.source.contentHash
    ) {
      if (options?.allowSourceUpdate) {
        updateTaskItem(taskId, item.wikiId, { source: latestSource });
      } else {
        updateTaskItem(taskId, item.wikiId, {
          source: latestSource,
          status: "pending_review",
          approvedBy: undefined,
          approvedAt: undefined,
          error: "来源文档在迁移前发生更新，请重新检查标题和迁移路径",
        });
        addTaskAuditLog(taskId, { wikiId: item.wikiId, action: "item_updated", detail: "来源内容已变化，需重新处理" });
        return { id: item.wikiId, outcome: "needs_review" as const };
      }
    }

    // 若已记录有效 targetNodeToken，先检查是否已存在于飞书，若存在则直接全量更新正文与标题
    if (item.targetNodeToken) {
      let origin = "https://open.feishu.cn";
      try {
        origin = new URL(task.config.targetWikiRoot.startsWith("http") ? task.config.targetWikiRoot : `https://${task.config.targetWikiRoot}`).origin;
      } catch {
        // ignore
      }
      const existing = destination.existingNodesByToken?.get(item.targetNodeToken) ||
        (await checkWikiNodeExists(destination.spaceId, item.targetNodeToken, origin));
      if (existing) {
        try {
          await updateDocumentContent(existing.documentToken, `${provenanceMarkdown(item, operator)}${markdown}`, { title: item.finalTitle });
        } catch (updateErr) {
          console.warn("更新已有飞书文档内容警告:", updateErr);
        }
        updateTaskItem(taskId, item.wikiId, {
          status: "migrated",
          targetNodeToken: existing.nodeToken,
          targetDocumentToken: existing.documentToken,
          targetUrl: existing.url,
          migratedAt: new Date().toISOString(),
          error: undefined,
        });
        addTaskAuditLog(taskId, {
          wikiId: item.wikiId,
          action: "migration_succeeded",
          operator,
          detail: `已全量更新最新内容至飞书文档（Token: ${existing.nodeToken}）`,
        });
        return { id: item.wikiId, outcome: "migrated" as const, nodeToken: existing.nodeToken };
      }
    }

    // 确定目标父节点 Token 优先级：
    // 1. 显式指定的 options.parentNodeToken（如目录整体迁移自顶向下遍历）
    // 2. 之前已持久化记录的 targetParentNodeToken
    // 3. 祖先追溯：遍历 Confluence 祖先列表，寻找最近已迁移成功（status === 'migrated'）且目标分类一致的节点 Token
    let parentNodeToken = options?.parentNodeToken || item.targetParentNodeToken;

    if (!parentNodeToken && item.source?.ancestors?.length) {
      for (let i = item.source.ancestors.length - 1; i >= 0; i--) {
        const ancestorId = item.source.ancestors[i].id;
        const ancestorItem = getTaskItem(taskId, ancestorId);
        if (
          ancestorItem &&
          ancestorItem.status === "migrated" &&
          ancestorItem.targetNodeToken &&
          ancestorItem.finalPrimaryCategory === item.finalPrimaryCategory &&
          (ancestorItem.finalSecondaryCategory || "") === (item.finalSecondaryCategory || "")
        ) {
          parentNodeToken = ancestorItem.targetNodeToken;
          break;
        }
      }
    }

    const target = await createMigratedWikiDocument({
      destination,
      config: task.config,
      primaryCategory: item.finalPrimaryCategory,
      secondaryCategory: item.finalSecondaryCategory,
      parentNodeToken,
      title: item.finalTitle,
      markdown: `${provenanceMarkdown(item, operator)}${markdown}`,
    });

    updateTaskItem(taskId, item.wikiId, {
      status: "migrated",
      targetNodeToken: target.nodeToken,
      targetDocumentToken: target.documentToken,
      targetParentNodeToken: target.parentNodeToken || parentNodeToken,
      targetUrl: target.url,
      migratedAt: new Date().toISOString(),
      error: undefined,
    });
    addTaskAuditLog(taskId, {
      wikiId: item.wikiId,
      action: "migration_succeeded",
      operator,
      detail: `已创建飞书文档 ${target.nodeToken}`,
    });
    return { id: item.wikiId, outcome: "migrated" as const, nodeToken: target.nodeToken };
  } catch (error) {
    const current = getTaskItem(taskId, item.wikiId);
    updateTaskItem(taskId, item.wikiId, {
      status: "failed",
      targetParentNodeToken: options?.parentNodeToken || item.targetParentNodeToken,
      retryCount: (current?.retryCount || 0) + 1,
      error: error instanceof Error ? error.message : "写入飞书失败",
    });
    addTaskAuditLog(taskId, {
      wikiId: item.wikiId,
      action: "migration_failed",
      operator,
      detail: error instanceof Error ? error.message : "写入飞书失败",
    });
    return { id: item.wikiId, outcome: "failed" as const };
  } finally {
    persistMigrationState();
  }
}

export async function publishTaskItems(taskId: string, wikiIds: string[]) {
  const task = requireTask(taskId);
  const selected = getTaskItems(taskId)
    .filter((item) => wikiIds.includes(item.wikiId) && item.status !== "migrating")
    .sort((a, b) => (a.source.ancestors?.length || 0) - (b.source.ancestors?.length || 0));
  if (!selected.length) throw new Error("没有可迁移的选中文档（文档正在迁移中或未找到）");

  const destination = await loadWikiDestination(task.config);
  saveTaskTargetDirectories(taskId, destination.directories);

  const invalidItems = selected.filter(
    (item) => !isValidCategory(item.finalPrimaryCategory, item.finalSecondaryCategory, destination.taxonomy)
  );
  if (invalidItems.length) {
    throw new Error(`${invalidItems.length} 篇文档的目标目录已不存在或已变更，请重新选择迁移路径后再试`);
  }

  // 按树层级深度分批处理：确保父级先迁移完成并记录 targetNodeToken，子级随后可自动挂载到父级下
  const depthGroups = new Map<number, KnowledgeMigrationItem[]>();
  for (const item of selected) {
    const depth = item.source.ancestors?.length || 0;
    if (!depthGroups.has(depth)) depthGroups.set(depth, []);
    depthGroups.get(depth)!.push(item);
  }
  const sortedDepths = Array.from(depthGroups.keys()).sort((a, b) => a - b);
  const limit = pLimit(2);
  const results: Array<{ id: string; outcome: "migrated" | "needs_review" | "failed"; nodeToken?: string }> = [];

  for (const depth of sortedDepths) {
    const group = depthGroups.get(depth)!;
    const groupResults = await Promise.all(
      group.map((item) =>
        limit(() => {
          const latestItem = getTaskItem(taskId, item.wikiId) || item;
          return publishOneTaskItem(taskId, latestItem, destination);
        })
      )
    );
    results.push(...groupResults);
  }

  // 刷新树状态
  void syncTaskTree(taskId).catch(() => undefined);

  return {
    total: results.length,
    migrated: results.filter((r) => r.outcome === "migrated").length,
    needsReview: results.filter((r) => r.outcome === "needs_review").length,
    failed: results.filter((r) => r.outcome === "failed").length,
  };
}

function findTaskTreeNode(nodes: WikiTreeNode[] | undefined, wikiId: string): WikiTreeNode | undefined {
  for (const node of nodes || []) {
    if (String(node.id) === String(wikiId)) return node;
    const found = findTaskTreeNode(node.children, wikiId);
    if (found) return found;
  }
  return undefined;
}

/**
 * 将一个源 Wiki 目录作为整体迁移到指定的飞书二级目录。
 * 飞书 Wiki 没有可创建的 folder 节点，所以源目录和文件均以可嵌套的
 * Docx Wiki 节点创建；由父节点先创建来保留原始层级。
 */
export async function migrateTaskDirectory(
  taskId: string,
  input: { rootWikiId: string; primaryCategory: string; secondaryCategory?: string; includeRoot: boolean }
) {
  const task = requireTask(taskId);
  const root = findTaskTreeNode(task.tree, input.rootWikiId);
  if (!root) throw new Error("未找到要整体迁移的源目录，请先同步 Wiki 目录树");
  if (!(root.children || []).length) throw new Error("当前选中节点不包含子目录或文件，无法按目录整体迁移");

  const destination = await loadWikiDestination(task.config);
  saveTaskTargetDirectories(taskId, destination.directories);
  if (!isValidCategory(input.primaryCategory, input.secondaryCategory, destination.taxonomy)) {
    throw new Error("请选择有效的飞书目标目录");
  }

  const targetFolderToken =
    (input.secondaryCategory ? destination.folders.get(`${input.primaryCategory}/${input.secondaryCategory}`) : undefined) ||
    destination.folders.get(input.primaryCategory);
  if (!targetFolderToken) throw new Error("未找到指定的飞书目标目录");

  const result = { total: 0, migrated: 0, excluded: 0, skipped: 0, needsReview: 0, failed: 0, blocked: 0 };
  const destName = input.secondaryCategory ? `${input.primaryCategory} / ${input.secondaryCategory}` : input.primaryCategory;
  addTaskAuditLog(taskId, {
    action: "migration_started",
    wikiId: root.id,
    detail: `开始整体迁移目录「${root.title}」至「${destName}」`,
  });

  async function migrateNode(node: WikiTreeNode, parentNodeToken: string): Promise<void> {
    const item = getTaskItem(taskId, String(node.id));
    if (!item) {
      result.failed += 1;
      result.blocked += countMigratableNodes(node.children);
      addTaskAuditLog(taskId, {
        action: "migration_failed",
        wikiId: node.id,
        detail: "源目录节点缺少迁移记录，已停止该分支。请先同步 Wiki 目录树后重试",
      });
      return;
    }

    result.total += 1;
    // 忽略节点本身不创建；其未忽略的后代继续挂到最近的已创建父节点下。
    if (item.status === "skipped") {
      result.skipped += 1;
      for (const child of node.children || []) await migrateNode(child, parentNodeToken);
      return;
    }

    let childParentToken: string | undefined;
    if (item.status === "migrated") {
      // 已迁移文档完全排除，不重复创建；已有目标节点仅作为后代的挂载父级。
      result.excluded += 1;
      childParentToken = item.targetNodeToken || parentNodeToken;
    } else if (item.status === "migrating") {
      result.failed += 1;
      result.blocked += countMigratableNodes(node.children);
      addTaskAuditLog(taskId, {
        action: "migration_failed",
        wikiId: item.wikiId,
        detail: "该节点正在迁移中，已停止该分支，请完成后重试整体迁移",
      });
      return;
    } else {
      // 目录整体迁移统一记录目标一级/二级目录与父节点；实际父子关系由 parentNodeToken 决定。
      const prepared = updateTaskItem(taskId, item.wikiId, {
        finalPrimaryCategory: input.primaryCategory,
        finalSecondaryCategory: input.secondaryCategory,
        targetParentNodeToken: parentNodeToken,
        error: undefined,
      });
      if (!prepared) throw new Error(`未找到 Wiki ID 为 ${item.wikiId} 的迁移文档`);
      const published = await publishOneTaskItem(taskId, prepared, destination, {
        parentNodeToken,
        // 整体迁移不依赖模型分类，直接采用迁移时读取到的最新正文即可。
        allowSourceUpdate: true,
      });
      if (published.outcome === "migrated") {
        childParentToken = published.nodeToken;
        result.migrated += 1;
      } else if (published.outcome === "needs_review") {
        result.needsReview += 1;
        result.blocked += countMigratableNodes(node.children);
        return;
      } else {
        result.failed += 1;
        result.blocked += countMigratableNodes(node.children);
        return;
      }
    }

    if (!childParentToken) {
      result.failed += 1;
      result.blocked += countMigratableNodes(node.children);
      return;
    }

    for (const child of node.children || []) {
      await migrateNode(child, childParentToken);
    }
  }

  if (input.includeRoot) {
    await migrateNode(root, targetFolderToken);
  } else {
    for (const child of root.children || []) {
      await migrateNode(child, targetFolderToken);
    }
  }
  addTaskAuditLog(taskId, {
    action: result.failed || result.needsReview ? "migration_failed" : "migration_succeeded",
    wikiId: root.id,
    detail: `目录「${root.title}」${input.includeRoot ? "及其下级内容" : "下级内容（不含当前目录）"}迁移完成：新建 ${result.migrated}，排除已迁移 ${result.excluded}，忽略 ${result.skipped}，失败 ${result.failed}，待重新处理 ${result.needsReview}`,
  });
  persistMigrationState();
  void syncTaskTree(taskId).catch(() => undefined);
  return result;
}

function countMigratableNodes(nodes: WikiTreeNode[] | undefined): number {
  return (nodes || []).reduce((total, node) => total + 1 + countMigratableNodes(node.children), 0);
}

// ----------------------------------------------------
// 兼容性接口封装（保留老代码与默认任务对接）
// ----------------------------------------------------

export function getMigrationOverview() {
  const task = getTask();
  if (!task) return { jobs: [], counts: { discovered: 0, pending_review: 0, approved: 0, migrating: 0, migrated: 0, failed: 0, skipped: 0 }, total: 0 };
  return getTaskOverview(task.id);
}

export async function startScan() {
  const task = getTask();
  if (!task) throw new Error("未找到任务");
  return startTaskScan(task.id);
}

export function reviewItem(input: {
  id: string;
  title?: string;
  primaryCategory?: string;
  secondaryCategory?: string;
  action?: "save" | "skip" | "reset";
  operator?: string;
}) {
  const task = getTask();
  if (!task) throw new Error("未找到任务");
  return reviewTaskItem(task.id, { ...input, wikiId: input.id });
}

export async function publishItems(ids: string[]) {
  const task = getTask();
  if (!task) throw new Error("未找到任务");
  return publishTaskItems(task.id, ids);
}
