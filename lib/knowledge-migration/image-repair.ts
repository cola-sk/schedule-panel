import "server-only";
import pLimit from "p-limit";
import { getFeishuClient } from "@/lib/mcp/feishu-doc-engine";
import { downloadConfluenceImages, getPage, storageXhtmlToMarkdown, storageXhtmlToMigratableMarkdown, toSourceDocument } from "./confluence";
import { updateDocumentContent } from "@/lib/mcp/feishu-doc-engine";
import { addTaskAuditLog, getTasks, persistMigrationState, updateTaskItem } from "./store";
import type { KnowledgeMigrationItem, KnowledgeMigrationTask } from "./types";

type RepairCandidate = {
  task: KnowledgeMigrationTask;
  item: KnowledgeMigrationItem;
  expectedImages: number;
  actualImages: number;
};

export type ImageRepairProgress = {
  status: "idle" | "running" | "completed" | "completed_with_errors";
  startedAt?: string;
  finishedAt?: string;
  total: number;
  scanned: number;
  candidates: number;
  repaired: number;
  skipped: number;
  failed: number;
  currentTitle?: string;
  errors: string[];
  retryingFailedOnly?: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __knowledgeMigrationImageRepairProgress__: ImageRepairProgress | undefined;
}

function progress(): ImageRepairProgress {
  return global.__knowledgeMigrationImageRepairProgress__ || {
    status: "idle",
    total: 0,
    scanned: 0,
    candidates: 0,
    repaired: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

function setProgress(changes: Partial<ImageRepairProgress>) {
  global.__knowledgeMigrationImageRepairProgress__ = { ...progress(), ...changes };
  return global.__knowledgeMigrationImageRepairProgress__;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function retryRateLimited<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      // Both the SDK and the platform may surface a rate limit as HTTP 400.
      // Back off before retrying so an intermittent document read is not
      // recorded as a permanently failed migration.
      if (attempt < 3) await wait(800 * (attempt + 1));
    }
  }
  throw lastError;
}

function blockText(elements?: Array<any>) {
  return (elements || [])
    .map((element) => element.text_run?.content || "")
    .join("");
}

async function inspectTargetDocument(documentToken: string) {
  const client = getFeishuClient();
  const result = await client.docx.documentBlockChildren.get({
    path: { document_id: documentToken, block_id: documentToken },
    params: { page_size: 500 },
  });
  if (result.code !== 0) throw new Error(result.msg || "读取飞书文档块失败");
  const blocks = result.data?.items || [];
  const header = blocks
    .filter((block: any) => block.block_type === 15)
    .map((block: any) => blockText(block.quote?.elements))
    .join("\n");
  return {
    wikiId: header.match(/Wiki 唯一 ID：\s*(\d+)/)?.[1],
    imageCount: blocks.filter((block: any) => block.block_type === 27).length,
  };
}

async function waitForImageBlocks(documentToken: string, minimumImageCount: number) {
  // Media binding is eventually consistent.  Do not treat an immediate read
  // after a successful write as a failed migration; poll for a short, bounded
  // period instead.
  let target = await retryRateLimited(() => inspectTargetDocument(documentToken));
  for (let attempt = 0; target.imageCount < minimumImageCount && attempt < 5; attempt += 1) {
    await wait(1000);
    target = await retryRateLimited(() => inspectTargetDocument(documentToken));
  }
  return target;
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
  return [
    "> 📌 文档迁移溯源信息",
    `> Wiki 唯一 ID：${item.wikiId}`,
    `> 来源文档：${item.source.title}（${item.source.url}）`,
    `> 原作者：${item.source.createdBy || "未知"} ｜ 创建时间：${formatTime(item.source.createdAt)}`,
    `> 最后更新人：${item.source.updatedBy || "未知"} ｜ 更新时间：${formatTime(item.source.updatedAt)}`,
    ...(operator && operator !== "未填写" ? [`> 归档人：${operator}`] : []),
    "",
    "---",
    "",
  ].join("\n");
}

async function findMissingImageCandidate(task: KnowledgeMigrationTask, item: KnowledgeMigrationItem): Promise<RepairCandidate | null> {
  if (!item.targetDocumentToken) return null;
  const target = await retryRateLimited(() => inspectTargetDocument(item.targetDocumentToken!));
  // The migration header is the source of truth: a stale local mapping must
  // never overwrite a different document that a user moved or repurposed.
  if (!target.wikiId || target.wikiId !== item.wikiId) {
    throw new Error(`飞书文档头部 Wiki ID 不匹配（读取到：${target.wikiId || "缺失"}）`);
  }

  const page = await retryRateLimited(() => getPage(task.config, item.wikiId));
  const source = storageXhtmlToMigratableMarkdown(page.body?.storage?.value || "");
  if (!source.images.length || target.imageCount >= source.images.length) return null;
  return { task, item, expectedImages: source.images.length, actualImages: target.imageCount };
}

async function repairCandidate(candidate: RepairCandidate) {
  const { task, item } = candidate;
  if (!item.targetDocumentToken || !item.targetNodeToken) throw new Error("迁移记录缺少目标飞书文档绑定");
  const page = await retryRateLimited(() => getPage(task.config, item.wikiId));
  const storage = page.body?.storage?.value || "";
  const content = storageXhtmlToMigratableMarkdown(storage);
  const images = await retryRateLimited(() => downloadConfluenceImages(task.config, page.id, content.images));
  const operator = task.config.defaultOperatorName?.trim() || item.approvedBy?.trim();

  await retryRateLimited(() => updateDocumentContent(item.targetDocumentToken!, `${provenanceMarkdown(item, operator)}${content.markdown}`, {
    title: item.finalTitle,
    images,
  }));

  // Verify the external write before recording success locally.
  const repaired = await waitForImageBlocks(item.targetDocumentToken!, images.size);
  if (repaired.imageCount < images.size) {
    throw new Error(`飞书图片块校验失败：预期至少 ${images.size}，实际 ${repaired.imageCount}`);
  }

  updateTaskItem(task.id, item.wikiId, {
    status: "migrated",
    source: toSourceDocument(task.config, page, storageXhtmlToMarkdown(storage)),
    migratedAt: new Date().toISOString(),
    error: undefined,
  });
  addTaskAuditLog(task.id, {
    wikiId: item.wikiId,
    action: "migration_succeeded",
    operator,
    detail: `图片修复：飞书图片块 ${candidate.actualImages} → ${repaired.imageCount}，源页面图片 ${images.size} 张`,
  });
  persistMigrationState();
}

export function getImageRepairProgress() {
  return progress();
}

/** Force-rewrite one known FEB migration after a renderer bug fix. */
export async function repairOneDocument(wikiId: string) {
  const match = getTasks()
    .flatMap((task) => Object.values(task.items).map((item) => ({ task, item })))
    .find(({ item }) => item.wikiId === wikiId && item.status === "migrated" && item.targetDocumentToken);
  if (!match) throw new Error(`未找到已迁移的 Wiki 文档 ${wikiId}`);

  const page = await retryRateLimited(() => getPage(match.task.config, wikiId));
  const source = storageXhtmlToMigratableMarkdown(page.body?.storage?.value || "");
  if (!source.images.length) throw new Error("该源页面不包含可迁移图片");
  const target = await retryRateLimited(() => inspectTargetDocument(match.item.targetDocumentToken!));
  if (target.wikiId !== wikiId) throw new Error("飞书文档头部 Wiki ID 不匹配，已拒绝覆盖");

  await repairCandidate({
    task: match.task,
    item: match.item,
    expectedImages: source.images.length,
    actualImages: target.imageCount,
  });
  return { wikiId, imageCount: source.images.length, previousImageCount: target.imageCount };
}

export function startImageRepair() {
  if (progress().status === "running") return progress();

  const documents = getTasks().flatMap((task) =>
    Object.values(task.items)
      .filter((item) => item.status === "migrated" && item.targetDocumentToken)
      .map((item) => ({ task, item })),
  );
  // A document may be visible in more than one historical task. Scan it once.
  const uniqueDocuments = Array.from(
    new Map(documents.map((entry) => [entry.item.targetDocumentToken!, entry])).values(),
  );

  setProgress({
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    total: uniqueDocuments.length,
    scanned: 0,
    candidates: 0,
    repaired: 0,
    skipped: 0,
    failed: 0,
    currentTitle: undefined,
    errors: [],
  });

  void (async () => {
    const candidates: RepairCandidate[] = [];
    // Keep reads just below Feishu's per-app document API threshold. The
    // initial high-concurrency pass hit HTTP 400 throttling for many valid
    // documents, so retries deliberately trade speed for completeness.
    const limit = pLimit(1);
    await Promise.all(
      uniqueDocuments.map(({ task, item }) =>
        limit(async () => {
          try {
            setProgress({ currentTitle: item.finalTitle || item.source.title });
            const candidate = await findMissingImageCandidate(task, item);
            const current = progress();
            setProgress({
              scanned: current.scanned + 1,
              candidates: current.candidates + (candidate ? 1 : 0),
              skipped: current.skipped + (candidate ? 0 : 1),
            });
            if (candidate) candidates.push(candidate);
          } catch (error) {
            const current = progress();
            const message = `${item.finalTitle || item.wikiId}：${error instanceof Error ? error.message : "扫描失败"}`;
            setProgress({
              scanned: current.scanned + 1,
              failed: current.failed + 1,
              errors: [...current.errors.slice(-49), message],
            });
          }
          await wait(350);
        }),
      ),
    );

    // Rewrites are intentionally serial: each rewrite can create many blocks
    // and Feishu enforces a tight per-document editing limit.
    for (const candidate of candidates) {
      try {
        setProgress({ currentTitle: candidate.item.finalTitle || candidate.item.source.title });
        await repairCandidate(candidate);
        setProgress({ repaired: progress().repaired + 1 });
      } catch (error) {
        const message = `${candidate.item.finalTitle || candidate.item.wikiId}：${error instanceof Error ? error.message : "重迁失败"}`;
        setProgress({ failed: progress().failed + 1, errors: [...progress().errors.slice(-49), message] });
      }
    }

    const current = progress();
    setProgress({
      status: current.failed ? "completed_with_errors" : "completed",
      finishedAt: new Date().toISOString(),
      currentTitle: undefined,
    });
  })();

  return progress();
}

/** Retry only documents retained in the most recent failure list. No full scan. */
export function retryFailedImageRepairs() {
  if (progress().status === "running") return progress();

  const failedTitles = new Set(
    progress().errors.map((message) => message.slice(0, message.indexOf("："))).filter(Boolean),
  );
  const documents = getTasks().flatMap((task) =>
    Object.values(task.items)
      .filter((item) => item.status === "migrated" && item.targetDocumentToken)
      .filter((item) => failedTitles.has(item.finalTitle || item.source.title))
      .map((item) => ({ task, item })),
  );
  const uniqueDocuments = Array.from(
    new Map(documents.map((entry) => [entry.item.targetDocumentToken!, entry])).values(),
  );

  setProgress({
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    total: uniqueDocuments.length,
    scanned: 0,
    candidates: uniqueDocuments.length,
    repaired: 0,
    skipped: 0,
    failed: 0,
    currentTitle: undefined,
    errors: [],
    retryingFailedOnly: true,
  });

  void (async () => {
    for (const { task, item } of uniqueDocuments) {
      try {
        setProgress({ currentTitle: item.finalTitle || item.source.title });
        const target = await retryRateLimited(() => inspectTargetDocument(item.targetDocumentToken!));
        const page = await retryRateLimited(() => getPage(task.config, item.wikiId));
        const source = storageXhtmlToMigratableMarkdown(page.body?.storage?.value || "");
        if (!source.images.length) {
          setProgress({ skipped: progress().skipped + 1, scanned: progress().scanned + 1 });
          continue;
        }
        await repairCandidate({
          task,
          item,
          expectedImages: source.images.length,
          actualImages: target.imageCount,
        });
        setProgress({ repaired: progress().repaired + 1, scanned: progress().scanned + 1 });
      } catch (error) {
        const message = `${item.finalTitle || item.wikiId}：${error instanceof Error ? error.message : "重迁失败"}`;
        setProgress({
          scanned: progress().scanned + 1,
          failed: progress().failed + 1,
          errors: [...progress().errors.slice(-49), message],
        });
      }
    }
    const current = progress();
    setProgress({
      status: current.failed ? "completed_with_errors" : "completed",
      finishedAt: new Date().toISOString(),
      currentTitle: undefined,
    });
  })();

  return progress();
}
