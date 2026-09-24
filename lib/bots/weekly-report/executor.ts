import {
  getFeishuClient,
  parseDocumentTarget,
  copyDocumentContent,
  formatLarkError,
} from "../../mcp/feishu-doc-engine";
import { sendWebhookMessage } from "../../core/feishu-client";
import { TaskExecutionContext, TaskExecutionResult } from "../types";
import { buildWeeklyReportNotification } from "./template";
import { computeWeekPeriodInfo, WeekPeriodInfo } from "./period";

type WikiChildNode = {
  node_token?: string;
  obj_token?: string;
  title?: string;
  obj_type?: string;
  has_child?: boolean;
};

async function listWikiChildren(client: any, spaceId: string, parentToken: string): Promise<WikiChildNode[]> {
  const items: WikiChildNode[] = [];
  let pageToken: string | undefined;
  do {
    let response;
    try {
      response = await client.wiki.spaceNode.list({
        path: { space_id: spaceId },
        params: {
          parent_node_token: parentToken,
          page_size: 50,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
    } catch (error) {
      throw new Error(formatLarkError(error, "读取飞书知识库目录列表失败"));
    }
    if (response.code !== 0) throw new Error(formatLarkError(response, "读取飞书知识库目录列表失败"));
    items.push(...((response.data?.items ?? []) as WikiChildNode[]));
    pageToken = response.data?.has_more ? response.data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function createWikiDocxNodeWithRetry(
  client: any,
  spaceId: string,
  parentNodeToken: string,
  title: string,
): Promise<{ node_token: string; obj_token: string; url?: string }> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const created = await client.wiki.spaceNode.create({
        path: { space_id: spaceId },
        data: {
          obj_type: "docx",
          node_type: "origin",
          parent_node_token: parentNodeToken,
          title,
        },
      });
      const code = created?.code ?? created?.response?.data?.code;
      const msg = created?.msg || created?.message || "";
      const isLock =
        code === 131009 ||
        msg.includes("131009") ||
        msg.includes("lock contention") ||
        msg.includes("resource locked");

      if (isLock && attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, 1000 * attempt + Math.floor(Math.random() * 500)));
        continue;
      }
      if (created.code !== 0) throw created;
      const node = created?.data?.node;
      if (!node?.node_token || !node?.obj_token) {
        throw new Error(formatLarkError(created, `在目录 [${parentNodeToken}] 下创建节点 [${title}] 失败`));
      }
      return {
        node_token: node.node_token,
        obj_token: node.obj_token,
        url: node.url,
      };
    } catch (err: any) {
      const code = err?.code ?? err?.response?.data?.code;
      const msg = err?.msg || err?.message || "";
      const isLock =
        code === 131009 ||
        msg.includes("131009") ||
        msg.includes("lock contention") ||
        msg.includes("resource locked");

      if (isLock && attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, 1000 * attempt + Math.floor(Math.random() * 500)));
        continue;
      }
      throw new Error(formatLarkError(err, `在知识库创建节点 [${title}] 失败`));
    }
  }
  throw new Error(`在知识库创建节点 [${title}] 超时`);
}

/**
 * 确保在指定 parentNodeToken 下存在指定名称的子节点；若已存在则返回，不存在则创建
 */
async function getOrCreateWikiNode(
  client: any,
  spaceId: string,
  parentNodeToken: string,
  targetTitle: string,
  aliases: string[] = [],
): Promise<{ nodeToken: string; objToken: string; isCreated: boolean }> {
  const children = await listWikiChildren(client, spaceId, parentNodeToken);
  const titlesToMatch = [targetTitle.trim(), ...aliases.map((a) => a.trim())];
  const existing = children.find((child) =>
    child.title && titlesToMatch.includes(child.title.trim())
  );

  if (existing && existing.node_token && existing.obj_token) {
    return {
      nodeToken: existing.node_token,
      objToken: existing.obj_token,
      isCreated: false,
    };
  }

  const created = await createWikiDocxNodeWithRetry(client, spaceId, parentNodeToken, targetTitle);
  return {
    nodeToken: created.node_token,
    objToken: created.obj_token,
    isCreated: true,
  };
}

async function copyWikiNodeWithRetry(
  client: any,
  sourceSpaceId: string,
  sourceNodeToken: string,
  targetSpaceId: string,
  targetParentNodeToken: string,
  title: string,
): Promise<{ nodeToken: string; objToken: string }> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const copied = await client.wiki.spaceNode.copy({
        path: { space_id: sourceSpaceId, node_token: sourceNodeToken },
        data: {
          target_space_id: targetSpaceId,
          target_parent_token: targetParentNodeToken,
          title,
        },
      });
      const code = copied?.code ?? copied?.response?.data?.code;
      const msg = copied?.msg || copied?.message || "";
      const isLock =
        code === 131009 ||
        msg.includes("131009") ||
        msg.includes("lock contention") ||
        msg.includes("resource locked");

      if (isLock && attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, 1000 * attempt + Math.floor(Math.random() * 500)));
        continue;
      }
      if (copied.code !== 0) throw copied;

      const node = copied.data?.node;
      if (!node?.node_token || !node?.obj_token) {
        throw new Error(formatLarkError(copied, `复制知识库模板 [${title}] 失败`));
      }
      return { nodeToken: node.node_token, objToken: node.obj_token };
    } catch (error: any) {
      const code = error?.code ?? error?.response?.data?.code;
      const msg = error?.msg || error?.message || "";
      const isLock =
        code === 131009 ||
        msg.includes("131009") ||
        msg.includes("lock contention") ||
        msg.includes("resource locked");

      if (isLock && attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, 1000 * attempt + Math.floor(Math.random() * 500)));
        continue;
      }
      throw new Error(formatLarkError(error, `复制知识库模板 [${title}] 失败`));
    }
  }
  throw new Error(`复制知识库模板 [${title}] 超时`);
}

function extractFeishuDomain(...urls: (string | undefined)[]): string {
  for (const url of urls) {
    if (!url) continue;
    try {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        const parsed = new URL(url);
        if (parsed.hostname.includes("feishu.cn") || parsed.hostname.includes("larksuite.com")) {
          return `${parsed.protocol}//${parsed.hostname}`;
        }
      }
    } catch {
      // ignore
    }
  }
  return "https://feishu.cn";
}

/**
 * 执行周报文档复制归档任务的核心函数
 */
export async function executeWeeklyReportTask(
  context: TaskExecutionContext,
): Promise<TaskExecutionResult> {
  const { schedule, bot, scheduledAt } = context;
  const sourceDoc = schedule.sourceDocumentId || schedule.documentId;
  const targetWiki = schedule.targetFolderId;

  if (!sourceDoc) {
    throw new Error("请先配置周报模板源文档地址（sourceDocumentId）");
  }
  if (!targetWiki) {
    throw new Error("请先配置目标知识库根目录地址（targetFolderId）");
  }

  const period = computeWeekPeriodInfo(scheduledAt || new Date());
  const client = getFeishuClient();
  const sourceParsed = parseDocumentTarget(sourceDoc);

  // 2. 解析目标知识库根节点
  const targetParsed = parseDocumentTarget(targetWiki);
  if (!targetParsed.wikiToken) {
    throw new Error("目标目录必须是有效的飞书知识库节点链接或 wikiToken");
  }

  const rootRes = await client.wiki.space.getNode({
    params: { token: targetParsed.wikiToken, obj_type: "wiki" },
  });
  if (rootRes.code !== 0 || !rootRes.data?.node?.space_id) {
    throw new Error(formatLarkError(rootRes, "读取目标知识库根节点失败，请检查应用是否有权限"));
  }
  const spaceId = rootRes.data.node.space_id;
  const rootNodeToken = targetParsed.wikiToken;

  // 3. 递归定位或创建层级：根目录 -> 年份汇总目录（如 2026工作汇总）
  const yearNode = await getOrCreateWikiNode(client, spaceId, rootNodeToken, period.yearName);

  // 4. 递归定位或创建层级：年份汇总目录 -> 月份目录（如 202609）
  const monthNode = await getOrCreateWikiNode(client, spaceId, yearNode.nodeToken, period.monthName);

  // 5. 复制模板为周报文档。知识库模板使用原生节点复制，完整保留表格和富文本格式。
  const weekTitle = period.weekTitle;
  const existingWeekNode = (await listWikiChildren(client, spaceId, monthNode.nodeToken)).find(
    (node) => node.title?.trim() === weekTitle && node.node_token && node.obj_token,
  );

  let weekNode: { nodeToken: string; objToken: string; isCreated: boolean };
  if (existingWeekNode?.node_token && existingWeekNode.obj_token) {
    await copyDocumentContent(sourceDoc, existingWeekNode.obj_token, { title: weekTitle });
    weekNode = {
      nodeToken: existingWeekNode.node_token,
      objToken: existingWeekNode.obj_token,
      isCreated: false,
    };
  } else if (sourceParsed.wikiToken) {
    const sourceNodeResult = await client.wiki.space.getNode({
      params: { token: sourceParsed.wikiToken, obj_type: "wiki" },
    });
    const sourceSpaceId = sourceNodeResult.data?.node?.space_id;
    if (sourceNodeResult.code !== 0 || !sourceSpaceId) {
      throw new Error(formatLarkError(sourceNodeResult, "读取周报模板知识库节点失败"));
    }
    const copiedNode = await copyWikiNodeWithRetry(
      client,
      sourceSpaceId,
      sourceParsed.wikiToken,
      spaceId,
      monthNode.nodeToken,
      weekTitle,
    );
    weekNode = { ...copiedNode, isCreated: true };
  } else {
    const createdNode = await createWikiDocxNodeWithRetry(client, spaceId, monthNode.nodeToken, weekTitle);
    await copyDocumentContent(sourceDoc, createdNode.obj_token, { title: weekTitle });
    weekNode = {
      nodeToken: createdNode.node_token,
      objToken: createdNode.obj_token,
      isCreated: true,
    };
  }

  const baseDomain = extractFeishuDomain(schedule.targetFolderId, schedule.sourceDocumentId);
  const docUrl = `${baseDomain}/wiki/${weekNode.nodeToken}`;

  // 7. 发送群通知（如果配置了机器人 Webhook）
  let mocked = true;
  let notificationSent = false;
  let notificationNote = "";

  if (bot) {
    if (bot.enabled && bot.webhookUrl) {
      const payload = buildWeeklyReportNotification({
        title: weekTitle,
        documentUrl: docUrl,
      });
      try {
        await sendWebhookMessage(bot.webhookUrl, payload);
        mocked = false;
        notificationSent = true;
        notificationNote = "（已同步发送飞书群提醒）";
      } catch (notifyErr: any) {
        console.warn("周报创建成功，但发送群通知失败:", notifyErr);
        notificationNote = `（飞书群提醒发送失败: ${notifyErr?.message || "网络异常"}）`;
      }
    } else if (!bot.webhookUrl) {
      notificationNote = `（提示：机器人「${bot.name}」未配置 Webhook，仅归档文档未发送群通知）`;
    } else {
      notificationNote = `（提示：机器人「${bot.name}」已停用，未发送群通知）`;
    }
  }

  const contentSummary = `已自动生成周报《${weekTitle}》，存放于【${period.yearName} / ${period.monthName}】目录。文档地址: ${docUrl}${notificationNote}`;

  return {
    mocked,
    botId: bot?.id,
    botName: bot?.name,
    content: contentSummary,
    documentUrl: docUrl,
    createdNodeToken: weekNode.nodeToken,
  };
}
