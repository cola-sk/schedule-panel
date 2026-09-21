import "server-only";
import { createHash } from "crypto";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { KnowledgeMigrationConfig, SourceDocument } from "./types";

type ConfluencePerson = { displayName?: string; username?: string; publicName?: string };
type ConfluencePage = {
  id: string;
  title: string;
  ancestors?: Array<{ id: string; title: string }>;
  history?: { createdBy?: ConfluencePerson; createdDate?: string };
  version?: { number?: number; when?: string; by?: ConfluencePerson };
  body?: { storage?: { value?: string } };
};
type PageListResponse = { results?: ConfluencePage[]; size?: number };

function personName(person?: ConfluencePerson) {
  return person?.displayName || person?.publicName || person?.username;
}

function normalizeBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  // 允许用户直接粘贴 Confluence 页面地址，例如 /pages/viewpage.action?pageId=...
  // REST API 的根地址应保留站点/应用 context path，但不能包含具体页面路径和查询参数。
  const pagePath = "/pages/viewpage.action";
  const pageIndex = url.pathname.indexOf(pagePath);
  if (pageIndex >= 0) url.pathname = url.pathname.slice(0, pageIndex);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function getHeaders(config: KnowledgeMigrationConfig) {
  const headers: Record<string, string> = { Accept: "application/json" };
  const secret = config.confluenceSecret?.trim();
  if (!secret) {
    throw new Error("当前归档任务尚未配置 Confluence 访问凭据 (PAT Token 或密码)。请点击「编辑任务」填入凭据后再试。");
  }
  if (config.confluenceAuthType === "pat") headers.Authorization = `Bearer ${secret}`;
  if (config.confluenceAuthType === "basic") {
    if (!config.confluenceUsername?.trim()) throw new Error("Basic Auth 需要填写 Confluence 用户名");
    headers.Authorization = `Basic ${Buffer.from(`${config.confluenceUsername}:${secret}`).toString("base64")}`;
  }
  if (config.confluenceAuthType === "cookie") headers.Cookie = secret;
  return headers;
}

async function confluenceRequest<T>(config: KnowledgeMigrationConfig, pathname: string): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(config.confluenceBaseUrl)}${pathname}`, {
    headers: getHeaders(config),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    try {
      const parsed = JSON.parse(detail) as {
        data?: { authorized?: boolean };
        message?: string;
        statusCode?: number;
      };
      if (
        parsed.data?.authorized === false ||
        (parsed.message && parsed.message.includes("not permitted to view content"))
      ) {
        const idMatch = parsed.message?.match(/id\s*:\s*ContentId\{id=(\d+)\}/i);
        const pageId = idMatch ? idMatch[1] : "";
        throw new Error(
          `Confluence 权限不足：当前凭据无权访问页面${pageId ? ` (ID: ${pageId})` : ""}。请检查当前账号是否具备该页面/空间的查看权限，或页面是否被作者设置了查看限制（挂锁）。`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Confluence 权限不足")) throw e;
    }
    throw new Error(`Confluence 请求失败 (${response.status})：${detail || response.statusText}`);
  }
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Confluence 返回的不是 JSON。请检查地址是否为站点根地址（当前请求：${pathname}），以及认证方式是否正确。`);
  }
}

export function parseRootPageIds(raw: string): string[] {
  return raw
    .split(/[\s,，\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sourceUrl(config: { confluenceBaseUrl: string }, pageId: string) {
  return `${normalizeBaseUrl(config.confluenceBaseUrl)}/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
}

export async function listDescendantPages(config: { confluenceBaseUrl: string; confluenceAuthType: any; confluenceUsername?: string; confluenceSecret?: string; confluenceRootPageId: string }): Promise<ConfluencePage[]> {
  const rootIds = parseRootPageIds(config.confluenceRootPageId);
  if (!rootIds.length) throw new Error("请填写 Confluence 根页面或节点 ID");
  const pages: ConfluencePage[] = [];
  const visited = new Set<string>(rootIds);
  const pending = [...rootIds];

  while (pending.length) {
    const parentId = pending.shift()!;
    let start = 0;
    try {
      while (true) {
        const result = await confluenceRequest<PageListResponse>(
          config as any,
          `/rest/api/content/${encodeURIComponent(parentId)}/child/page?start=${start}&limit=100&expand=history,version,ancestors,body.storage`,
        );
        const children = result.results ?? [];
        for (const page of children) {
          if (visited.has(page.id)) continue;
          visited.add(page.id);
          pages.push(page);
          pending.push(page.id);
        }
        if (children.length < 100) break;
        start += children.length;
      }
    } catch (err) {
      // 若是唯一根节点直接无权限，向上抛出明确错误给用户
      if (rootIds.includes(parentId) && pages.length === 0 && pending.length === 0) {
        throw err;
      }
      console.warn(`读取节点 ${parentId} 的子页面失败，跳过该子分支:`, err);
    }
  }
  return pages;
}

export async function getPage(config: { confluenceBaseUrl: string; confluenceAuthType: any; confluenceUsername?: string; confluenceSecret?: string }, pageId: string): Promise<ConfluencePage> {
  return confluenceRequest<ConfluencePage>(
    config as any,
    `/rest/api/content/${encodeURIComponent(pageId)}?expand=history,version,ancestors,body.storage`,
  );
}

import type { WikiTreeNode, KnowledgeMigrationItem } from "./types";

export function buildWikiTree(
  rootPages: ConfluencePage[],
  descendantPages: ConfluencePage[],
  baseUrl: string,
  itemsMap: Record<string, KnowledgeMigrationItem> = {}
): WikiTreeNode[] {
  const nodeMap = new Map<string, WikiTreeNode>();

  // 1. 初始化所有节点
  for (const page of [...rootPages, ...descendantPages]) {
    if (!nodeMap.has(page.id)) {
      const ancestors = page.ancestors?.map((a) => ({ id: a.id, title: a.title })) ?? [];
      const parentId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : undefined;
      const path = ancestors.map((a) => a.title).filter(Boolean);
      const item = itemsMap[page.id];

      nodeMap.set(page.id, {
        id: page.id,
        title: page.title,
        parentId,
        url: `${normalizeBaseUrl(baseUrl)}/pages/viewpage.action?pageId=${encodeURIComponent(page.id)}`,
        path,
        hasChildren: false,
        children: [],
        status: item?.status || "discovered",
      });
    }
  }

  // 2. 组装父子树
  const rootIds = new Set(rootPages.map((p) => p.id));
  const roots: WikiTreeNode[] = [];

  for (const [id, node] of nodeMap.entries()) {
    if (rootIds.has(id)) {
      roots.push(node);
    } else if (node.parentId && nodeMap.has(node.parentId) && !rootIds.has(id)) {
      const parent = nodeMap.get(node.parentId)!;
      parent.children.push(node);
      parent.hasChildren = true;
    } else {
      // 孤立节点作为根节点呈现
      roots.push(node);
    }
  }

  // 3. 递归计算子树统计信息（counts 统计下级子文档数量，不将节点自身计入子文档总数）
  function calculateCounts(n: WikiTreeNode): {
    total: number;
    migrated: number;
    pending: number;
    failed: number;
    skipped: number;
  } {
    let childTotal = 0;
    let childMigrated = 0;
    let childPending = 0;
    let childFailed = 0;
    let childSkipped = 0;

    for (const child of n.children) {
      const s = child.status || "discovered";
      const isMigrated = s === "migrated" ? 1 : 0;
      const isPending = ["discovered", "pending_review", "approved", "migrating"].includes(s) ? 1 : 0;
      const isFailed = s === "failed" ? 1 : 0;
      const isSkipped = s === "skipped" ? 1 : 0;

      const subCounts = calculateCounts(child);
      childTotal += 1 + subCounts.total;
      childMigrated += isMigrated + subCounts.migrated;
      childPending += isPending + subCounts.pending;
      childFailed += isFailed + subCounts.failed;
      childSkipped += isSkipped + subCounts.skipped;
    }

    n.counts = {
      total: childTotal,
      migrated: childMigrated,
      pending: childPending,
      failed: childFailed,
      skipped: childSkipped,
    };
    return n.counts;
  }

  roots.forEach(calculateCounts);
  return roots;
}

/** 根据本地最新文档状态刷新树节点进度，避免发布/忽略后等待下一次远端同步。 */
export function refreshWikiTreeProgress(
  nodes: WikiTreeNode[],
  itemsMap: Record<string, KnowledgeMigrationItem> = {}
): WikiTreeNode[] {
  function calculate(node: WikiTreeNode): WikiTreeNode {
    const children = (node.children || []).map(calculate);
    const item = itemsMap[String(node.id)];
    const status = item?.status || node.status || "discovered";

    let total = 0;
    let migrated = 0;
    let pending = 0;
    let failed = 0;
    let skipped = 0;

    for (const child of children) {
      const childCounts = child.counts || { total: 0, migrated: 0, pending: 0, failed: 0, skipped: 0 };
      const childStatus = child.status || "discovered";
      total += 1 + childCounts.total;
      migrated += (childStatus === "migrated" ? 1 : 0) + childCounts.migrated;
      pending += (["discovered", "pending_review", "approved", "migrating"].includes(childStatus) ? 1 : 0) + childCounts.pending;
      failed += (childStatus === "failed" ? 1 : 0) + childCounts.failed;
      skipped += (childStatus === "skipped" ? 1 : 0) + childCounts.skipped;
    }

    return {
      ...node,
      status,
      children,
      counts: { total, migrated, pending, failed, skipped },
    };
  }

  return nodes.map(calculate);
}

export async function fetchWikiHierarchy(
  config: { confluenceBaseUrl: string; confluenceAuthType: any; confluenceUsername?: string; confluenceSecret?: string; confluenceRootPageId: string },
  itemsMap: Record<string, KnowledgeMigrationItem> = {}
): Promise<{ roots: WikiTreeNode[]; allPages: ConfluencePage[] }> {
  const rootIds = parseRootPageIds(config.confluenceRootPageId);
  if (!rootIds.length) throw new Error("请配置 Confluence 根页面或节点 ID");

  // 1. 获取所有根节点信息
  const rootPages: ConfluencePage[] = [];
  for (const rootId of rootIds) {
    try {
      const rootPage = await getPage(config, rootId);
      rootPages.push(rootPage);
    } catch {
      rootPages.push({ id: rootId, title: `根节点 (${rootId})` });
    }
  }

  // 2. 递归获取所有后代页面
  const descendantPages = await listDescendantPages(config);

  // 3. 构建完整的树结构
  const roots = buildWikiTree(rootPages, descendantPages, config.confluenceBaseUrl, itemsMap);

  return { roots, allPages: [...rootPages, ...descendantPages] };
}

function macroLabel(name: string) {
  return ({ info: "提示", warning: "警告", note: "说明", tip: "建议" } as Record<string, string>)[name] || "提示";
}

/** Converts the most common Confluence storage macros into semantic HTML before Markdown conversion. */
export function storageXhtmlToMarkdown(storageXhtml: string) {
  const $ = cheerio.load(storageXhtml, { xmlMode: true });
  const tableMarkdown: string[] = [];

  // Turndown's GFM table rule only recognizes tables whose first row is a
  // header row. Confluence commonly emits ordinary <td> cells (and uses
  // colspan/rowspan), so normalize every table ourselves before conversion.
  $("table").each((_, table) => {
    const rows = $(table).find("tr").toArray().map((row) => $(row).find("th,td").toArray());
    if (!rows.length) return;
    const columnCount = Math.max(...rows.map((row) => row.reduce((count, cell) => count + Math.max(1, Number($(cell).attr("colspan")) || 1), 0)));
    const grid: string[][] = [];
    const pending: Array<{ value: string; remaining: number } | undefined> = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const output = Array.from({ length: columnCount }, () => "");
      const spans = Array.from({ length: columnCount }, () => 0);
      for (let col = 0; col < columnCount; col += 1) {
        const pendingCell = pending[col];
        if (pendingCell) {
          output[col] = pendingCell.value;
          spans[col] = pendingCell.remaining;
          pendingCell.remaining -= 1;
          if (pendingCell.remaining <= 0) pending[col] = undefined;
        }
      }
      let col = 0;
      for (const cell of rows[rowIndex]) {
        while (col < columnCount && output[col]) col += 1;
        if (col >= columnCount) break;
        const cellHtml = $(cell).html() || "";
        const cellText = new TurndownService({ bulletListMarker: "-" })
          .use(gfm)
          .turndown(cellHtml)
          .replace(/\s*\n\s*/g, " <br> ")
          .replace(/\|/g, "\\|")
          .trim();
        const colspan = Math.max(1, Number($(cell).attr("colspan")) || 1);
        const rowspan = Math.max(1, Number($(cell).attr("rowspan")) || 1);
        for (let offset = 0; offset < colspan && col + offset < columnCount; offset += 1) {
          output[col + offset] = cellText;
          if (rowspan > 1) pending[col + offset] = { value: cellText, remaining: rowspan - 1 };
        }
        col += colspan;
      }
      grid.push(output);
      // Keep the row-span values for the next iteration while allowing cells
      // that were filled by a real cell above to take precedence.
      for (let index = 0; index < columnCount; index += 1) {
        if (spans[index] > 0 && !pending[index]) pending[index] = { value: output[index], remaining: spans[index] };
      }
    }
    const headerIndex = rows.some((row) => row.some((cell) => $(cell).is("th")))
      ? rows.findIndex((row) => row.some((cell) => $(cell).is("th")))
      : 0;
    // Confluence often uses the first row as a visual group label (for
    // example, "业务需求 / 埋点属性") and the next row as the actual table
    // header. Keep that label as a short callout instead of duplicating it
    // across every colspan-expanded cell.
    let groupLabel = "";
    if (!rows.some((row) => row.some((cell) => $(cell).is("th"))) && grid.length > 1) {
      const firstRowValues = [...new Set((grid[0] || []).map((value) => value.trim()).filter(Boolean))];
      if (firstRowValues.length > 0 && firstRowValues.length <= 2 && (grid[0] || []).filter(Boolean).length >= 2) {
        groupLabel = firstRowValues.join("：");
        grid.shift();
      }
    }
    // Drop columns that are empty for the entire table. They are usually
    // artifacts of an empty trailing <td> used for layout in Confluence.
    while (grid.length && grid.every((row) => !String(row[row.length - 1] || "").trim())) {
      grid.forEach((row) => row.pop());
    }
    const header = grid[headerIndex] || grid[0] || [];
    header.forEach((value, index) => {
      if (!value.trim() && grid.slice(headerIndex + 1).some((row) => String(row[index] || "").trim())) {
        header[index] = "补充说明";
      }
    });
    const lines = [
      ...(groupLabel ? [`> ${groupLabel}`, ""] : []),
      ...grid.slice(0, headerIndex).map((row) => `| ${row.join(" | ")} |`),
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...grid.slice(headerIndex + 1).map((row) => `| ${row.join(" | ")} |`),
    ];
    const placeholder = `CONFLUENCE-TABLE-${tableMarkdown.length}`;
    tableMarkdown.push(lines.join("\n"));
    $(table).replaceWith(`<p>${placeholder}</p>`);
  });

  $("ac\\:structured-macro").each((_, element) => {
    const macro = ($(element).attr("ac:name") || "").toLowerCase();
    const plainTextBody = $(element).find("ac\\:plain-text-body");
    const body = ($(element).find("ac\\:rich-text-body").html() || plainTextBody.text() || $(element).text())
      .replace(/^\s*<!\[CDATA\[/, "")
      .replace(/\]\]>\s*$/, "");
    if (macro === "code") {
      $(element).replaceWith(`<pre><code>${escapeHtml(body)}</code></pre>`);
    } else if (["info", "warning", "note", "tip"].includes(macro)) {
      $(element).replaceWith(`<blockquote><strong>${macroLabel(macro)}</strong><br/>${body}</blockquote>`);
    } else if (macro === "expand") {
      const title = $(element).find("ac\\:parameter[ac\\:name='title']").text().trim() || "展开内容";
      $(element).replaceWith(`<details><summary>${escapeHtml(title)}</summary>${body}</details>`);
    } else if (macro === "toc") {
      $(element).remove();
    } else if (macro === "status") {
      $(element).replaceWith(`<span>${escapeHtml($(element).find("ac\\:parameter").text() || $(element).text())}</span>`);
    } else {
      $(element).replaceWith(body);
    }
  });
  $("ac\\:link").each((_, element) => {
    const label = $(element).text().trim() || $(element).find("ri\\:page").attr("ri:content-title") || "Confluence 链接";
    const pageId = $(element).find("ri\\:page").attr("ri:content-id");
    $(element).replaceWith(pageId ? `<a href="/pages/viewpage.action?pageId=${pageId}">${escapeHtml(label)}</a>` : escapeHtml(label));
  });
  $("ac\\:image").each((_, element) => {
    const attachment = $(element).find("ri\\:attachment").attr("ri:filename");
    const remoteUrl = $(element).find("ri\\:url").attr("ri:value");
    const label = attachment ? `图片附件：${attachment}` : "图片或附件（请查看来源原文）";
    $(element).replaceWith(remoteUrl ? `<p><a href="${escapeHtml(remoteUrl)}">${escapeHtml(label)}</a></p>` : `<p>${escapeHtml(label)}</p>`);
  });
  $("ri\\:attachment, ri\\:url").remove();

  const turndown = new TurndownService({ codeBlockStyle: "fenced", bulletListMarker: "-" }).use(gfm);
  turndown.addRule("details", {
    filter: "details",
    replacement: (content) => `\n\n> ${content.trim()}\n\n`,
  });
  return turndown.turndown($.root().html() || "")
    .replace(/CONFLUENCE-TABLE-(\d+)/g, (_, index) => `\n\n${tableMarkdown[Number(index)]}\n\n`)
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isContentEmpty(raw: string | undefined | null): boolean {
  if (!raw) return true;
  // 移除 XML/HTML 注释以及 CDATA 标记
  let cleaned = raw.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[|\]\]>/g, "");
  // 目录文档经常仅包含目录宏 [TOC]，宏本身不代表作者编写的正文内容
  cleaned = cleaned.replace(/<ac:structured-macro\s+ac:name="toc"[\s\S]*?<\/ac:structured-macro>/gi, "");
  // 若包含图片、附件、嵌入表格或非 TOC 宏等实体，则视为有内容
  if (/<(?:ac:image|ri:attachment|img|iframe|table|ac:structured-macro)/i.test(cleaned)) {
    return false;
  }
  // 剥离 HTML/XML 标签与各种不可见空格后判定
  const textOnly = cleaned
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/\s+/g, "")
    .trim();
  return textOnly.length === 0;
}

export function toSourceDocument(
  config: { confluenceBaseUrl: string },
  page: ConfluencePage,
  content?: string
): SourceDocument {
  const ancestors = (page.ancestors ?? []).map((ancestor) => ({ id: ancestor.id, title: ancestor.title }));
  const path = ancestors.map((ancestor) => ancestor.title).filter(Boolean);
  const parentId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : undefined;
  const rawStorage = page.body?.storage?.value;
  const effectiveContent = content !== undefined && content !== "" ? content : (rawStorage || "");
  const empty = isContentEmpty(effectiveContent);
  return {
    pageId: page.id,
    url: sourceUrl(config, page.id),
    title: page.title,
    path,
    parentId,
    ancestors,
    version: page.version?.number ?? 0,
    contentHash: createHash("sha256").update(effectiveContent).digest("hex"),
    createdBy: personName(page.history?.createdBy),
    createdAt: page.history?.createdDate,
    updatedBy: personName(page.version?.by),
    updatedAt: page.version?.when,
    contentEmpty: empty,
    contentLength: effectiveContent.length,
  };
}
