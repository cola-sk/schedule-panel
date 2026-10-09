import "server-only";
import pLimit from "p-limit";
import { getAIModelConfig } from "@/lib/ai-config/store";
import { readDocument } from "@/lib/mcp/feishu-doc-engine";
import { recommendOtherDirectoryDocument } from "./classifier";
import { getOrCreateWikiDirectory, listWikiDocumentsBelow, loadWikiDestination, moveWikiNode, type FeishuWikiDocument } from "./feishu";
import { getTask } from "./store";
import { isValidCategory, taxonomyFromDirectories, type OtherDirectoryDocument, type OtherDirectoryRecommendation } from "./types";

function originFromUrl(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

async function readWikiDocumentContent(document: FeishuWikiDocument): Promise<string> {
  if (document.objType === "file") {
    throw new Error("附件未读取正文，已仅依据文件标题和目录路径生成建议");
  }
  if (document.objType === "doc") {
    throw new Error("旧版飞书文档暂不支持读取正文，建议仅依据标题和目录路径生成");
  }
  if (document.objType && !["docx", "sheet", "bitable"].includes(document.objType)) {
    throw new Error(`飞书节点类型 ${document.objType} 暂不支持读取正文，建议仅依据标题和目录路径生成`);
  }
  const content = await readDocument(document.url || document.documentToken, { format: "markdown" });
  return typeof content.content === "string" ? content.content : "";
}

/**
 * 读取目标知识库“其他”目录的所有文档，并给出迁移目录建议。
 * 这是只读分析：不会创建目录、移动节点或改写任何飞书文档。
 */
export async function analyzeOtherDirectory(taskId: string): Promise<{
  sourceDirectory: string;
  scannedAt: string;
  taxonomy: Record<string, string[]>;
  documents: OtherDirectoryDocument[];
}> {
  const task = getTask(taskId);
  if (!task) throw new Error("未找到指定的知识库归档任务");
  if (!task.config.targetWikiRoot) throw new Error("请先配置目标飞书知识库根节点");

  const destination = await loadWikiDestination(task.config, { fetchExistingDocs: false });
  const sourceDirectory = destination.directories.find((directory) => directory.title.trim() === "其他");
  if (!sourceDirectory) throw new Error("目标飞书知识库中未找到名为“其他”的一级目录");

  const targetTaxonomy = taxonomyFromDirectories(
    destination.directories.filter((directory) => directory.nodeToken !== sourceDirectory.nodeToken),
  );
  if (!Object.keys(targetTaxonomy).length) throw new Error("除“其他”外未读取到可作为迁移目标的目录");

  const documents = await listWikiDocumentsBelow(
    destination.spaceId,
    sourceDirectory.nodeToken,
    originFromUrl(task.config.targetWikiRoot),
  );
  const llmConfig = getAIModelConfig();
  const limit = pLimit(3);

  const analyzed = await Promise.all(
    documents.map((document) =>
      limit(async (): Promise<OtherDirectoryDocument> => {
        let markdown = "";
        let contentWarning: string | undefined;
        try {
          markdown = await readWikiDocumentContent(document);
        } catch (error) {
          contentWarning = error instanceof Error ? error.message : "正文读取失败，建议仅依据标题和目录路径生成";
        }
        try {
          const recommendation = await recommendOtherDirectoryDocument(
            llmConfig,
            { title: document.title, path: [sourceDirectory.title, ...document.path] },
            contentWarning ? "（正文不可读取，请仅依据标题和来源路径判断）" : markdown,
            targetTaxonomy,
          );
          return {
            ...document,
            path: [sourceDirectory.title, ...document.path],
            contentLength: contentWarning ? undefined : markdown.length,
            contentWarning,
            recommendation,
          };
        } catch (error) {
          return {
            ...document,
            path: [sourceDirectory.title, ...document.path],
            contentWarning,
            recommendation: {
              targetKind: "existing_directory",
              error: error instanceof Error ? error.message : "读取或分析文档失败",
            },
          };
        }
      }),
    ),
  );

  return { sourceDirectory: sourceDirectory.title, scannedAt: new Date().toISOString(), taxonomy: targetTaxonomy, documents: analyzed };
}

/** 将“其他”目录中的单个节点移动到经用户确认的建议目标。 */
export async function migrateOtherDirectoryDocument(
  taskId: string,
  input: { nodeToken: string; recommendation: OtherDirectoryRecommendation },
): Promise<{ targetLabel: string; createdDirectory: boolean }> {
  const task = getTask(taskId);
  if (!task) throw new Error("未找到指定的知识库归档任务");

  const destination = await loadWikiDestination(task.config, { fetchExistingDocs: false });
  const sourceDirectory = destination.directories.find((directory) => directory.title.trim() === "其他");
  if (!sourceDirectory) throw new Error("目标飞书知识库中未找到名为“其他”的一级目录");

  const sourceNodes = await listWikiDocumentsBelow(destination.spaceId, sourceDirectory.nodeToken, originFromUrl(task.config.targetWikiRoot));
  const sourceDocument = sourceNodes.find((node) => node.nodeToken === input.nodeToken);
  if (!sourceDocument) {
    throw new Error("该文档已不在“其他”目录中，请重新分析后再迁移");
  }

  const targetTaxonomy = taxonomyFromDirectories(
    destination.directories.filter((directory) => directory.nodeToken !== sourceDirectory.nodeToken),
  );
  const suggestion = input.recommendation;
  if (suggestion.error) throw new Error("该文档没有有效的迁移建议，请重新分析或人工处理");

  let targetParentNodeToken: string | undefined;
  let targetLabel = "";
  let createdDirectory = false;

  if (suggestion.targetKind === "existing_directory") {
    if (!isValidCategory(suggestion.primaryCategory, suggestion.secondaryCategory, targetTaxonomy)) {
      throw new Error("推荐的目标目录已失效，请重新分析后再迁移");
    }
    targetParentNodeToken = suggestion.secondaryCategory
      ? destination.folders.get(`${suggestion.primaryCategory}/${suggestion.secondaryCategory}`)
      : destination.folders.get(suggestion.primaryCategory!);
    targetLabel = [suggestion.primaryCategory, suggestion.secondaryCategory].filter(Boolean).join(" / ");
  } else {
    const name = suggestion.newDirectoryName?.trim() || "";
    const parent = suggestion.newDirectoryParent?.trim() || "";
    if (!name || name.length > 80 || (parent === "root" && name === sourceDirectory.title) || (parent !== "root" && !targetTaxonomy[parent])) {
      throw new Error("新目录建议无效，请重新分析后再迁移");
    }
    const parentNodeToken = parent === "root" ? destination.rootToken : destination.folders.get(parent);
    if (!parentNodeToken) throw new Error("未找到新目录的父级节点，请重新分析后再迁移");
    const directory = await getOrCreateWikiDirectory({
      spaceId: destination.spaceId,
      parentNodeToken,
      title: name,
    });
    targetParentNodeToken = directory.nodeToken;
    createdDirectory = directory.created;
    targetLabel = `${parent === "root" ? "目标根目录" : parent} / ${name}`;
  }

  if (!targetParentNodeToken) throw new Error("未找到迁移目标目录");
  await moveWikiNode({
    spaceId: destination.spaceId,
    nodeToken: input.nodeToken,
    targetParentNodeToken,
  });
  return { targetLabel, createdDirectory };
}
