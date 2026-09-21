import * as lark from "@larksuiteoapi/node-sdk";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";

function loadEnvFile(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        process.env[key] = value.replace(/^["'](.*)["']$/, "$1");
      }
    }
  } catch {
    // ignore
  }
}

// 确保能加载当前项目目录的 .env.local 和 .env
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

let cachedClient: lark.Client | undefined;

export function getFeishuClient(): lark.Client {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      "未检测到飞书应用凭证，请在环境变量或 .env.local 中配置 FEISHU_APP_ID 与 FEISHU_APP_SECRET",
    );
  }

  if (!cachedClient) {
    cachedClient = new lark.Client({ appId, appSecret });
  }
  return cachedClient;
}

export interface ParsedTarget {
  raw: string;
  type: "docx" | "wiki" | "sheet" | "bitable" | "unknown";
  documentId?: string;
  wikiToken?: string;
  appToken?: string;
  tableId?: string;
  sheetId?: string;
}

/**
 * 解析飞书文档、表格或 Wiki URL / Token
 */
export function parseDocumentTarget(urlOrToken: string): ParsedTarget {
  const trimmed = urlOrToken.trim();

  // Wiki 链接
  if (trimmed.includes("/wiki/")) {
    const match = trimmed.match(/\/wiki\/([a-zA-Z0-9_-]+)/);
    let tableId: string | undefined;
    let sheetId: string | undefined;
    try {
      const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      tableId = urlObj.searchParams.get("table") || undefined;
      sheetId = urlObj.searchParams.get("sheet") || undefined;
    } catch {
      // ignore
    }
    return {
      raw: trimmed,
      type: "wiki",
      wikiToken: match ? match[1] : undefined,
      tableId,
      sheetId,
    };
  }

  // 多维表格 Bitable
  if (trimmed.includes("/base/") || trimmed.includes("/bitable/")) {
    const match = trimmed.match(/\/(?:base|bitable)\/([a-zA-Z0-9_-]+)/);
    let tableId: string | undefined;
    try {
      const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      tableId = urlObj.searchParams.get("table") || undefined;
    } catch {
      // ignore
    }
    return {
      raw: trimmed,
      type: "bitable",
      appToken: match ? match[1] : undefined,
      tableId,
    };
  }

  // 电子表格 Sheets
  if (trimmed.includes("/sheets/")) {
    const match = trimmed.match(/\/sheets\/([a-zA-Z0-9_-]+)/);
    let sheetId: string | undefined;
    try {
      const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      sheetId = urlObj.searchParams.get("sheet") || undefined;
    } catch {
      // ignore
    }
    return {
      raw: trimmed,
      type: "sheet",
      appToken: match ? match[1] : undefined,
      sheetId,
    };
  }

  // Docx 链接
  if (trimmed.includes("/docx/") || trimmed.includes("/docs/")) {
    const match = trimmed.match(/\/(?:docx|docs)\/([a-zA-Z0-9_-]+)/);
    return {
      raw: trimmed,
      type: "docx",
      documentId: match ? match[1] : undefined,
    };
  }

  // 纯 Token 直接输入
  if (/^wik[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { raw: trimmed, type: "wiki", wikiToken: trimmed };
  }

  if (/^(?:dox|doc)[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { raw: trimmed, type: "docx", documentId: trimmed };
  }

  return { raw: trimmed, type: "docx", documentId: trimmed };
}

export interface ResolvedTarget {
  objType: "docx" | "sheet" | "bitable";
  token: string; // 实际的对象 Token (documentId 或 appToken)
  wikiToken?: string;
  title?: string;
  tableId?: string;
  sheetId?: string;
}

/**
 * 将任意文档目标（Wiki、Docx、Sheet 或 Bitable）解析为底层飞书对象信息
 */
export async function resolveDocumentTarget(
  client: lark.Client,
  urlOrToken: string,
): Promise<ResolvedTarget> {
  const parsed = parseDocumentTarget(urlOrToken);

  if (parsed.type === "wiki" && parsed.wikiToken) {
    let nodeRes;
    try {
      nodeRes = await client.wiki.space.getNode({
        params: { token: parsed.wikiToken, obj_type: "wiki" },
      });
    } catch (error: any) {
      throw new Error(
        formatLarkError(
          error,
          `读取知识库节点失败 (wikiToken: ${parsed.wikiToken})`,
        ),
      );
    }

    if (nodeRes.code !== 0) {
      throw new Error(
        formatLarkError(
          nodeRes,
          `读取知识库节点失败 (wikiToken: ${parsed.wikiToken})`,
        ),
      );
    }

    const objToken = nodeRes.data?.node?.obj_token;
    const objType = nodeRes.data?.node?.obj_type as "docx" | "sheet" | "bitable" | string;
    const title = nodeRes.data?.node?.title;

    if (!objToken) {
      throw new Error(`知识库节点 [${parsed.wikiToken}] 未找到关联的文档对象`);
    }

    return {
      objType: (objType === "doc" ? "docx" : objType) as "docx" | "sheet" | "bitable",
      token: objToken,
      wikiToken: parsed.wikiToken,
      title: title || undefined,
      tableId: parsed.tableId,
      sheetId: parsed.sheetId,
    };
  }

  if (parsed.type === "bitable" && parsed.appToken) {
    return {
      objType: "bitable",
      token: parsed.appToken,
      tableId: parsed.tableId,
    };
  }

  if (parsed.type === "sheet" && parsed.appToken) {
    return {
      objType: "sheet",
      token: parsed.appToken,
      sheetId: parsed.sheetId,
    };
  }

  const documentId = parsed.documentId || parsed.raw;
  return {
    objType: "docx",
    token: documentId,
  };
}

/**
 * 兼容旧方法名：将任意文档目标解析为 docx document_id
 */
export async function resolveRealDocumentId(
  client: lark.Client,
  urlOrToken: string,
): Promise<{ documentId: string; wikiToken?: string; title?: string }> {
  const resolved = await resolveDocumentTarget(client, urlOrToken);
  return {
    documentId: resolved.token,
    wikiToken: resolved.wikiToken,
    title: resolved.title,
  };
}

/**
 * 飞书富文本 elements 转换为 Markdown 字符串
 */
function elementsToMarkdown(elements?: Array<any>): string {
  if (!elements || !Array.isArray(elements)) return "";
  return elements
    .map((el) => {
      if (el.text_run) {
        let content = el.text_run.content || "";
        const style = el.text_run.text_element_style;
        if (style) {
          if (style.inline_code) content = `\`${content}\``;
          if (style.bold) content = `**${content}**`;
          if (style.italic) content = `*${content}*`;
          if (style.strikethrough) content = `~~${content}~~`;
          if (style.link?.url) {
            let url = style.link.url;
            try {
              url = decodeURIComponent(url);
            } catch {
              // ignore
            }
            content = `[${content}](${url})`;
          }
        }
        return content;
      }
      if (el.mention_user) {
        return `@${el.mention_user.user_id || "用户"}`;
      }
      if (el.mention_doc) {
        return `[${el.mention_doc.title || "飞书文档"}](${el.mention_doc.url || ""})`;
      }
      return "";
    })
    .join("");
}

/**
 * 将飞书 Block 列表转换为 Markdown
 */
export function convertBlocksToMarkdown(blocks: Array<any>): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const type = block.block_type;
    // block_type 1: page block (根块跳过)
    if (type === 1) continue;

    // 2: text (普通段落)
    if (type === 2 && block.text) {
      lines.push(elementsToMarkdown(block.text.elements));
      continue;
    }

    // 3~11: heading1 ~ heading9
    if (type >= 3 && type <= 11) {
      const headingKey = `heading${type - 2}`;
      const prefix = "#".repeat(type - 2) + " ";
      const text = elementsToMarkdown(block[headingKey]?.elements);
      lines.push(`${prefix}${text}`);
      continue;
    }

    // 12: bullet (无序列表)
    if (type === 12 && block.bullet) {
      lines.push(`- ${elementsToMarkdown(block.bullet.elements)}`);
      continue;
    }

    // 13: ordered (有序列表)
    if (type === 13 && block.ordered) {
      lines.push(`1. ${elementsToMarkdown(block.ordered.elements)}`);
      continue;
    }

    // 14: code (代码块)
    if (type === 14 && block.code) {
      const codeText = elementsToMarkdown(block.code.elements);
      lines.push("```\n" + codeText + "\n```");
      continue;
    }

    // 15: quote (引用)
    if (type === 15 && block.quote) {
      lines.push(`> ${elementsToMarkdown(block.quote.elements)}`);
      continue;
    }

    // 17: todo (待办)
    if (type === 17 && block.todo) {
      const isDone = block.todo.style?.done ? "x" : " ";
      lines.push(`- [${isDone}] ${elementsToMarkdown(block.todo.elements)}`);
      continue;
    }

    // 22: divider (分割线)
    if (type === 22) {
      lines.push("---");
      continue;
    }

    // 其他未知或复合 block，尝试提取 elements
    const anyBlockData = block.text || block[Object.keys(block).find((k) => k !== "block_id" && k !== "block_type" && k !== "parent_id") || ""];
    if (anyBlockData?.elements) {
      lines.push(elementsToMarkdown(anyBlockData.elements));
    }
  }

  return lines.join("\n\n");
}

/**
 * 将 Markdown / 纯文本解析为飞书 Docx 创建子块时需要的 Children 结构
 */
export function parseMarkdownToDocxBlocks(markdown: string): Array<any> {
  const blocks: Array<any> = [];
  const lines = normalizeLegacyConfluenceMarkdown(markdown).split(/\r?\n/);
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 代码块处理
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        // 代码块结束
        blocks.push({
          block_type: 14, // code
          code: {
            elements: [
              {
                text_run: {
                  content: codeBuffer.join("\n"),
                },
              },
            ],
          },
        });
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    // 空行跳过
    if (!trimmed) continue;

    // Confluence 兼容分隔线。独立于正式 Markdown 规则，处理旧页面中
    // 常见的 ====、------ 以及被转义为 \====、\------ 的写法。
    const legacySeparator = parseLegacyConfluenceSeparator(rawLine);
    if (legacySeparator) {
      blocks.push(legacySeparator);
      continue;
    }

    // GFM 表格。表格先保留为带行数据的 table block，写入时再用飞书的
    // table/cell API 创建真实表格，避免把每个单元格拆成独立段落。
    if (trimmed.startsWith("|") && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
      const tableLines = [trimmed];
      let cursor = i + 1;
      while (cursor < lines.length && lines[cursor].trim().startsWith("|")) {
        tableLines.push(lines[cursor].trim());
        cursor += 1;
      }
      const rows = tableLines
        .filter((line) => !isMarkdownTableSeparator(line))
        .map(splitMarkdownTableRow);
      if (rows.length && rows[0].length) {
        const columnSize = Math.max(...rows.map((row) => row.length));
        blocks.push({
          block_type: 31,
          table: {
            property: {
              row_size: rows.length,
              column_size: columnSize,
              header_row: true,
            },
            __rows: rows.map((row) => [...row, ...Array.from({ length: columnSize - row.length }, () => "")]),
          },
        });
      }
      i = cursor - 1;
      continue;
    }

    // 标准 Markdown 分割线
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      blocks.push({
        block_type: 22, // divider
        divider: {},
      });
      continue;
    }

    // 标题 # ~ ######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length; // 1 to 6
      const content = headingMatch[2];
      const blockType = level + 2; // heading1: 3, heading2: 4, ...
      const fieldKey = `heading${level}`;
      blocks.push({
        block_type: blockType,
        [fieldKey]: {
          elements: parseInlineElements(content),
        },
      });
      continue;
    }

    // 引用块 >
    if (trimmed.startsWith(">")) {
      const content = trimmed.replace(/^>\s*/, "");
      blocks.push({
        block_type: 15, // quote
        quote: {
          elements: parseInlineElements(content),
        },
      });
      continue;
    }

    // 待办 - [ ] 或 - [x]
    const todoMatch = trimmed.match(/^-\s*\[([ xX])\]\s+(.+)$/);
    if (todoMatch) {
      const isDone = todoMatch[1].toLowerCase() === "x";
      const content = todoMatch[2];
      blocks.push({
        block_type: 17, // todo
        todo: {
          style: { done: isDone },
          elements: parseInlineElements(content),
        },
      });
      continue;
    }

    // 标准 Markdown 无序列表 - 或 *
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        block_type: 12, // bullet
        bullet: {
          elements: parseInlineElements(bulletMatch[1]),
        },
      });
      continue;
    }

    // 标准 Markdown 有序列表 1. 或 2.
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      blocks.push({
        block_type: 13, // ordered
        ordered: {
          elements: parseInlineElements(orderedMatch[1]),
        },
      });
      continue;
    }

    // 普通段落
    blocks.push({
      block_type: 2, // text
      text: {
        elements: parseInlineElements(rawLine),
      },
    });
  }

  // 兜底代码块未闭合
  if (inCodeBlock && codeBuffer.length > 0) {
    blocks.push({
      block_type: 14,
      code: {
        elements: [
          {
            text_run: {
              content: codeBuffer.join("\n"),
            },
          },
        ],
      },
    });
  }

  return blocks;
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * 兼容 Confluence 导出时产生的轻量 Markdown 转义噪声与非标准格式。
 *
 * 这里独立于标准 Markdown 的解析规则，专门处理 Confluence 导出的特殊格式兼容（hack 处理）：
 * - 修正星号数量不匹配的加粗标记（例如 `*2.2 交互逻辑**` 或 `**2.2 交互逻辑*`）
 * - 修复 Markdown 链接中 URL 包含的 HTML 实体与转义字符（如 `&amp;` -> `&`，`\_` -> `_`）
 * - 兼容自动链接 `<https://...>` 与独立成行的裸 URL 转换
 * - \\*、\\_、\\-、\\. 等被错误转义的 Markdown 标记
 * - &#x20; / &nbsp; 和 <br> 这类常见 HTML 残留
 * - 单独成行的空加粗标记
 */
function normalizeLegacyConfluenceMarkdown(markdown: string) {
  return markdown
    .replace(/&#x20;|&#160;|&nbsp;/gi, " ")
    .replace(/\\?<br\s*\/?\s*>/gi, " ")
    // 兼容 <https://...> autolinks 语法
    .replace(/<(https?:\/\/[^\s>]+)>/g, "[$1]($1)")
    // 兼容独立成行的裸 URL
    .replace(/^(\s*)(https?:\/\/[^\s]+)(\s*)$/gm, "$1[$2]($2)$3")
    // 处理 Confluence 导出中星号数量不匹配的加粗标记（如 *2.2 交互逻辑** 或 **2.2 交互逻辑*）
    .replace(/(^|[\s(（>])\*{1,3}([^\s*][^*]*?)\*{2,3}($|[\s)）.,;:，。；：！？!?])/g, (match, prefix, content, suffix) => {
      return `${prefix}**${content.trim()}**${suffix}`;
    })
    .replace(/(^|[\s(（>])\*{2,3}([^\s*][^*]*?)\*{1,3}($|[\s)）.,;:，。；：！？!?])/g, (match, prefix, content, suffix) => {
      return `${prefix}**${content.trim()}**${suffix}`;
    })
    // 修复 markdown link 中 URL 包含的 HTML 实体与转义字符
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, text, url) => {
      const cleanUrl = url
        .replace(/&amp;/g, "&")
        .replace(/\\([_~*`()])/g, "$1");
      return `[${text}](${cleanUrl})`;
    })
    .split(/\r?\n/)
    .map((line) => {
      const normalized = line.replace(/\\([\\`*_[\]{}()#+.!?&=\-])/g, "$1");
      return /^\s*(?:\*\*|__)\s*$/.test(normalized) ? "" : normalized;
    })
    .join("\n");
}

/**
 * 兼容 Confluence 旧页面的视觉分隔线，不参与正式 Markdown 语法判断。
 */
function parseLegacyConfluenceSeparator(line: string) {
  const normalized = line.trim().replace(/^\\(?=[=-])/, "");
  if (!/^={4,}$/.test(normalized) && !/^-{4,}$/.test(normalized)) return undefined;
  return { block_type: 22, divider: {} };
}

function splitMarkdownTableRow(line: string) {
  const content = line.trim().replace(/^\|\s?/, "").replace(/\s?\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of content) {
    if (character === "|" && !escaped) {
      cells.push(current.trim().replace(/\\\|/g, "|"));
      current = "";
      continue;
    }
    current += character;
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  cells.push(current.trim().replace(/\\\|/g, "|"));
  return cells;
}

function parseInlineElements(value: string) {
  const elements: Array<any> = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|(https?:\/\/[^\s<>"'）\(\)\[\]]+))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      elements.push({ text_run: { content: unescapeMarkdownText(value.slice(lastIndex, match.index)) } });
    }
    const style: Record<string, unknown> = {};
    let content = "";
    if (match[2] !== undefined) {
      content = unescapeMarkdownText(match[2]);
      const rawUrl = match[3].replace(/&amp;/g, "&").replace(/\\([_~*`()])/g, "$1");
      // Feishu Docx only accepts web URLs for text links. Source documents
      // can contain app/deep links such as `ninebot://...`, which otherwise
      // makes the whole descendant request fail with 1770006.
      if (/^https?:\/\//i.test(rawUrl)) {
        style.link = { url: rawUrl };
      }
    } else if (match[4] !== undefined) {
      content = match[4];
      style.inline_code = true;
    } else if (match[5] !== undefined || match[6] !== undefined) {
      content = unescapeMarkdownText(match[5] ?? match[6] ?? "");
      style.bold = true;
    } else if (match[7] !== undefined) {
      content = unescapeMarkdownText(match[7]);
      style.strikethrough = true;
    } else if (match[8] !== undefined) {
      content = unescapeMarkdownText(match[8] || "");
      style.italic = true;
    } else if (match[9] !== undefined) {
      content = unescapeMarkdownText(match[9]);
      style.link = { url: match[9] };
    }
    elements.push({
      text_run: {
        content,
        ...(Object.keys(style).length ? { text_element_style: style } : {}),
      },
    });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < value.length || !elements.length) {
    elements.push({ text_run: { content: unescapeMarkdownText(value.slice(lastIndex)) } });
  }
  return elements;
}

function unescapeMarkdownText(value: string) {
  return value.replace(/\\([\\`*_[\]{}()#+.!-])/g, "$1");
}

export function formatLarkError(error: any, fallbackMessage: string): string {
  const values = [
    error,
    error?.response?.data,
    error?.error,
    ...(Array.isArray(error) ? error.flat(Infinity) : []),
  ].filter(Boolean);
  const apiMsg = values.find((value) => value?.msg)?.msg ||
    values.find((value) => value?.message)?.message ||
    error?.response?.data?.message ||
    error?.cause?.message ||
    error?.message;
  const status = error?.response?.status;
  const errCode = values.find((value) => typeof value?.code === "number")?.code ?? values.find((value) => value?.code !== undefined)?.code;

  if (errCode === 131006) {
    return `${fallbackMessage} [飞书知识库节点无读取权限 131006]：请在目标知识库的成员与权限设置中添加当前自建应用，并授予可查看/可编辑权限；同时确认应用已开通 wiki:wiki:readonly 并发布最新版本。`;
  }

  if (errCode === 1770032) {
    return `${fallbackMessage} [协作者权限不足 1770032]: 当前自建应用未获得该文档的编辑权限。请打开该文档/知识库页面，在右上角「分享」或「权限设置」中，将您的飞书自建应用添加为【可编辑】协作者（或在所属知识库空间设置中添加应用为成员）。`;
  }

  if (status === 403 || errCode === 99991663 || errCode === 99991664) {
    return `${fallbackMessage} [权限不足 403]: ${apiMsg || "应用无此权限"}。请在飞书开发者后台确认：1. 应用已开通对应权限（读: docx:document:readonly, wiki:wiki:readonly; 写: docx:document, wiki:wiki）；2. 应用版本已发布；3. 若是个人空间或特定群空间文档，需将飞书自建应用添加为该文档或文件夹的协作者（可编辑）。`;
  }

  if (errCode !== undefined) {
    return `${fallbackMessage} [错误码 ${errCode}]: ${apiMsg || "未知错误"}`;
  }

  return `${fallbackMessage}: ${apiMsg || String(error)}`;
}

/**
 * 获取飞书文档基本信息
 */
export async function getDocumentInfo(documentIdOrUrl: string) {
  const client = getFeishuClient();
  const target = await resolveDocumentTarget(client, documentIdOrUrl);

  if (target.objType !== "docx") {
    return {
      token: target.token,
      wikiToken: target.wikiToken,
      type: target.objType,
      title: target.title || (target.objType === "sheet" ? "电子表格" : "多维表格"),
      url: target.wikiToken
        ? `https://open.feishu.cn/wiki/${target.wikiToken}`
        : target.objType === "sheet"
        ? `https://open.feishu.cn/sheets/${target.token}`
        : `https://open.feishu.cn/base/${target.token}`,
    };
  }

  const documentId = target.token;
  let res;
  try {
    res = await client.docx.document.get({
      path: { document_id: documentId },
    });
  } catch (error: any) {
    throw new Error(formatLarkError(error, `获取文档基本信息失败 (document_id: ${documentId})`));
  }

  if (res.code !== 0) {
    throw new Error(formatLarkError(res, `获取文档基本信息失败 (document_id: ${documentId})`));
  }

  const doc = res.data?.document;
  return {
    documentId,
    wikiToken: target.wikiToken,
    type: "docx",
    title: doc?.title || target.title || "无标题文档",
    revisionId: doc?.revision_id,
    displaySetting: doc?.display_setting,
    url: target.wikiToken
      ? `https://open.feishu.cn/wiki/${target.wikiToken}`
      : `https://open.feishu.cn/docx/${documentId}`,
  };
}

/**
 * 读取飞书电子表格并转换为 Markdown 表格
 */
async function readSheetAsMarkdown(
  client: lark.Client,
  spreadsheetToken: string,
  targetSheetId?: string,
  title?: string,
): Promise<{ title: string; content: string; format: string; rowCount: number }> {
  let sheetId = targetSheetId;
  let sheetTitle = title || "电子表格";

  if (!sheetId) {
    try {
      const sheetsRes = await client.request<{
        data?: { sheets?: Array<{ sheet_id: string; title: string }> };
        code: number;
        msg: string;
      }>({
        url: `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
        method: "GET",
      });
      if (sheetsRes.code === 0 && sheetsRes.data?.sheets?.length) {
        sheetId = sheetsRes.data.sheets[0].sheet_id;
        sheetTitle = sheetsRes.data.sheets[0].title || sheetTitle;
      }
    } catch {
      // ignore
    }
  }

  const range = sheetId ? `${sheetId}!A1:Z500` : "A1:Z500";
  let valuesRes: any;
  try {
    valuesRes = await client.request<{
      data?: { valueRange?: { values?: Array<Array<unknown>> } };
      code: number;
      msg: string;
    }>({
      url: `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
      method: "GET",
    });
  } catch (err: any) {
    throw new Error(formatLarkError(err, "读取电子表格数据失败"));
  }

  if (valuesRes.code !== 0) {
    throw new Error(formatLarkError(valuesRes, "读取电子表格数据失败"));
  }

  const rows: Array<Array<unknown>> = valuesRes.data?.valueRange?.values ?? [];
  if (!rows || rows.length === 0) {
    return {
      title: sheetTitle,
      format: "markdown",
      rowCount: 0,
      content: `# ${sheetTitle}\n\n*表格内容为空*`,
    };
  }

  const header = (rows[0] || []).map((c) => String(c ?? "").trim() || " ");
  const sep = header.map(() => "---");
  const dataRows = rows.slice(1).map((row) =>
    header.map((_, i) => String(row[i] ?? "").trim().replace(/\|/g, "\\|") || " ")
  );

  const tableMd = [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...dataRows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

  return {
    title: sheetTitle,
    format: "markdown",
    rowCount: rows.length,
    content: `# ${sheetTitle}\n\n${tableMd}`,
  };
}

/**
 * 读取飞书多维表格并转换为 Markdown 表格
 */
async function readBitableAsMarkdown(
  client: lark.Client,
  appToken: string,
  targetTableId?: string,
  title?: string,
): Promise<{ title: string; content: string; format: string; rowCount: number }> {
  let tableId = targetTableId;
  let bitableTitle = title || "多维表格";

  if (!tableId) {
    let tablesRes;
    try {
      tablesRes = await client.bitable.appTable.list({
        path: { app_token: appToken },
        params: { page_size: 20 },
      });
    } catch (err) {
      throw new Error(formatLarkError(err, "读取多维表格元信息失败"));
    }
    if (tablesRes.code !== 0) {
      throw new Error(formatLarkError(tablesRes, "读取多维表格失败"));
    }
    tableId = tablesRes.data?.items?.[0]?.table_id;
    if (tablesRes.data?.items?.[0]?.name) {
      bitableTitle = tablesRes.data.items[0].name;
    }
  }

  if (!tableId) throw new Error("多维表格中未找到有效数据表");

  let recordsRes;
  try {
    recordsRes = await client.bitable.appTableRecord.list({
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 500 },
    });
  } catch (err) {
    throw new Error(formatLarkError(err, "读取多维表格记录失败"));
  }

  if (recordsRes.code !== 0) {
    throw new Error(formatLarkError(recordsRes, "读取多维表格记录失败"));
  }

  const items = recordsRes.data?.items ?? [];
  if (!items.length) {
    return {
      title: bitableTitle,
      format: "markdown",
      rowCount: 0,
      content: `# ${bitableTitle}\n\n*表格暂无记录*`,
    };
  }

  const fieldKeysSet = new Set<string>();
  items.forEach((item) => {
    Object.keys(item.fields || {}).forEach((k) => fieldKeysSet.add(k));
  });
  const headers = Array.from(fieldKeysSet);
  const sep = headers.map(() => "---");
  const dataRows = items.map((item) => {
    const fields = (item.fields || {}) as Record<string, unknown>;
    return headers.map((h) => {
      const val = fields[h];
      if (val === undefined || val === null) return " ";
      if (typeof val === "object") return JSON.stringify(val).replace(/\|/g, "\\|");
      return String(val).trim().replace(/\|/g, "\\|") || " ";
    });
  });

  const tableMd = [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...dataRows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

  return {
    title: bitableTitle,
    format: "markdown",
    rowCount: items.length,
    content: `# ${bitableTitle}\n\n${tableMd}`,
  };
}

/**
 * 读取飞书文档、表格或知识库内容
 */
export async function readDocument(
  documentIdOrUrl: string,
  options?: { format?: "markdown" | "text" | "raw_blocks" },
) {
  const client = getFeishuClient();
  const format = options?.format || "markdown";
  const target = await resolveDocumentTarget(client, documentIdOrUrl);

  // 1. 如果目标是电子表格 Sheet
  if (target.objType === "sheet") {
    const sheetRes = await readSheetAsMarkdown(
      client,
      target.token,
      target.sheetId,
      target.title,
    );
    return {
      documentId: target.token,
      wikiToken: target.wikiToken,
      title: sheetRes.title,
      format: "markdown",
      rowCount: sheetRes.rowCount,
      content: sheetRes.content,
    };
  }

  // 2. 如果目标是多维表格 Bitable
  if (target.objType === "bitable") {
    const bitableRes = await readBitableAsMarkdown(
      client,
      target.token,
      target.tableId,
      target.title,
    );
    return {
      documentId: target.token,
      wikiToken: target.wikiToken,
      title: bitableRes.title,
      format: "markdown",
      rowCount: bitableRes.rowCount,
      content: bitableRes.content,
    };
  }

  // 3. 目标为 Docx 云文档
  const documentId = target.token;
  const wikiToken = target.wikiToken;
  let title = target.title;
  try {
    const docRes = await client.docx.document.get({ path: { document_id: documentId } });
    if (docRes.code === 0 && docRes.data?.document?.title) {
      title = docRes.data.document.title;
    }
  } catch {
    // ignore
  }

  // 2. 如果只要纯文本，飞书提供了原生 rawContent
  if (format === "text") {
    try {
      const rawRes = await client.docx.document.rawContent({
        path: { document_id: documentId },
      });
      if (rawRes.code === 0 && rawRes.data?.content) {
        return {
          documentId,
          wikiToken,
          title: title || "无标题文档",
          format: "text",
          content: rawRes.data.content,
        };
      }
    } catch {
      // 降级为 blocks 解析
    }
  }

  // 3. 分页拉取所有 blocks
  const allBlocks: Array<any> = [];
  let pageToken: string | undefined;

  do {
    let blockRes;
    try {
      blockRes = await client.docx.documentBlock.list({
        path: { document_id: documentId },
        params: {
          page_size: 500,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
    } catch (error: any) {
      throw new Error(formatLarkError(error, `读取文档块列表失败 (document_id: ${documentId})`));
    }

    if (blockRes.code !== 0) {
      throw new Error(formatLarkError(blockRes, `读取文档块列表失败 (document_id: ${documentId})`));
    }

    if (blockRes.data?.items) {
      allBlocks.push(...blockRes.data.items);
    }
    pageToken = blockRes.data?.has_more ? blockRes.data.page_token : undefined;
  } while (pageToken);

  if (format === "raw_blocks") {
    return {
      documentId,
      wikiToken,
      title: title || "无标题文档",
      format: "raw_blocks",
      blockCount: allBlocks.length,
      blocks: allBlocks,
    };
  }

  // 转换为 Markdown
  const markdownContent = convertBlocksToMarkdown(allBlocks);

  return {
    documentId,
    wikiToken,
    title: title || "无标题文档",
    format: "markdown",
    blockCount: allBlocks.length,
    content: `# ${title || "无标题文档"}\n\n${markdownContent}`.trim(),
  };
}

/**
 * 创建新飞书云文档
 */
export async function createDocument(params: {
  title: string;
  folderToken?: string;
  initialContent?: string;
}) {
  const client = getFeishuClient();
  const { title, folderToken, initialContent } = params;

  let createRes;
  try {
    createRes = await client.docx.document.create({
      data: {
        title,
        folder_token: folderToken || undefined,
      },
    });
  } catch (error: any) {
    throw new Error(formatLarkError(error, `创建飞书文档失败`));
  }

  if (createRes.code !== 0 || !createRes.data?.document?.document_id) {
    throw new Error(formatLarkError(createRes, `创建飞书文档失败`));
  }

  const documentId = createRes.data.document.document_id;
  let appendedCount = 0;

  // 如果提供了初始内容，追加到新文档中
  if (initialContent && initialContent.trim()) {
    try {
      const appendResult = await appendDocumentContent(documentId, initialContent);
      appendedCount = appendResult.appendedBlocks;
    } catch (err) {
      console.warn("文档创建成功，但写入初始内容时遇到问题:", err);
    }
  }

  return {
    documentId,
    title,
    appendedBlocks: appendedCount,
    url: `https://open.feishu.cn/docx/${documentId}`,
  };
}

/**
 * 向现有飞书云文档末尾追加内容
 */
export async function appendDocumentContent(
  documentIdOrUrl: string,
  content: string,
) {
  const client = getFeishuClient();
  const { documentId } = await resolveRealDocumentId(client, documentIdOrUrl);

  const blocks = parseMarkdownToDocxBlocks(content);
  if (blocks.length === 0) {
    return { documentId, appendedBlocks: 0, message: "内容为空，未追加任何块" };
  }

  // 飞书接口限制单次最多创建 50 个 block，若超出则分批追加。表格
  // 需要单独创建并填充 cell，不能把内部的 __rows 字段直接传给 API。
  const BATCH_SIZE = 50;
  let totalAppended = 0;
  let regularBlocks: Array<any> = [];
  const flushRegularBlocks = async () => {
    for (let i = 0; i < regularBlocks.length; i += BATCH_SIZE) {
      const chunk = regularBlocks.slice(i, i + BATCH_SIZE);
      let appendRes;
      try {
        appendRes = await client.docx.documentBlockChildren.create({
          path: {
            document_id: documentId,
            block_id: documentId,
          },
          data: { children: chunk, index: -1 },
        });
      } catch (error: any) {
        throw new Error(formatLarkError(error, `向飞书文档写入内容失败 (document_id: ${documentId})`));
      }
      if (appendRes.code !== 0) {
        throw new Error(formatLarkError(appendRes, `向飞书文档写入内容失败 (document_id: ${documentId})`));
      }
      totalAppended += chunk.length;
    }
    regularBlocks = [];
  };

  for (const block of blocks) {
    if (block.block_type !== 31 || !block.table?.__rows) {
      regularBlocks.push(block);
      continue;
    }
    await flushRegularBlocks();
    await appendTableBlock(client, documentId, block.table.property, block.table.__rows);
    totalAppended += 1;
  }
  await flushRegularBlocks();

  return {
    documentId,
    appendedBlocks: totalAppended,
    url: `https://open.feishu.cn/docx/${documentId}`,
  };
}

async function appendTableBlock(
  client: lark.Client,
  documentId: string,
  property: { row_size: number; column_size: number; header_row?: boolean },
  rows: string[][],
) {
  // Use the descendant API so the table, its cells, and each cell's text are
  // created in one atomic request. Creating the table first and then trying to
  // discover cell IDs is unreliable because the create-children response does
  // not consistently include the generated cells for all tenants.
  // Custom Docx block IDs must start with `doxcn` and stay within the API's
  // length limit. Keep the random suffix only; adding kind prefixes can make
  // table/cell/text IDs invalid and results in error 1770006.
  const id = () => `doxcn${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const tableId = id();
  const cellIds = rows.flatMap(() =>
    Array.from({ length: property.column_size }, () => id()),
  );
  const textIds = cellIds.map(() => id());
  const descendants: Array<any> = [
    {
      block_id: tableId,
      block_type: 31,
      children: cellIds,
      table: { property },
    },
    ...cellIds.map((cellId, index) => ({
      block_id: cellId,
      block_type: 32,
      children: [textIds[index]],
      table_cell: {},
    })),
    ...textIds.map((textId, index) => ({
      block_id: textId,
      block_type: 2,
      text: { elements: parseInlineElements(rows[Math.floor(index / property.column_size)]?.[index % property.column_size] || "") },
    })),
  ];
  try {
    const createRes = await client.docx.documentBlockDescendant.create({
      path: { document_id: documentId, block_id: documentId },
      data: { children_id: [tableId], descendants, index: -1 },
    });
    if (createRes.code !== 0) throw createRes;
  } catch (error: any) {
    throw new Error(formatLarkError(error, `创建飞书表格失败 (document_id: ${documentId})`));
  }
}

/**
 * 清空飞书文档的所有一级子块
 */
async function clearDocumentChildren(client: lark.Client, documentId: string) {
  while (true) {
    let listRes;
    try {
      listRes = await client.docx.documentBlockChildren.get({
        path: { document_id: documentId, block_id: documentId },
      });
    } catch (err: any) {
      throw new Error(formatLarkError(err, `获取文档子块失败 (document_id: ${documentId})`));
    }

    const items = listRes.data?.items || [];
    if (items.length === 0) break;

    // 飞书接口限制单次最多批量删除 50 个块
    const countToDelete = Math.min(items.length, 50);
    let delRes;
    try {
      delRes = await client.docx.documentBlockChildren.batchDelete({
        path: { document_id: documentId, block_id: documentId },
        data: {
          start_index: 0,
          end_index: countToDelete,
        },
      });
    } catch (err: any) {
      throw new Error(formatLarkError(err, `清空旧文档内容失败 (document_id: ${documentId})`));
    }

    if (delRes.code !== 0) {
      throw new Error(formatLarkError(delRes, `清空旧文档内容失败 (document_id: ${documentId})`));
    }
  }
}

/**
 * 全量更新/覆盖飞书文档内容（清空旧正文并写入全新 Markdown）
 */
export async function updateDocumentContent(
  documentIdOrUrl: string,
  newContent: string,
  options?: { title?: string },
) {
  const client = getFeishuClient();
  const { documentId, wikiToken, title: oldTitle } = await resolveRealDocumentId(
    client,
    documentIdOrUrl,
  );

  // 1. 清空所有旧子块
  await clearDocumentChildren(client, documentId);

  // 2. 写入全新的 Markdown 内容
  const appendRes = await appendDocumentContent(documentId, newContent);

  // 3. 如果需要同时更新标题，且提供了新标题
  if (options?.title) {
    try {
      // 针对 docx 页面根块更新标题
      await client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: documentId },
        data: {
          update_text_elements: {
            elements: [
              {
                text_run: {
                  content: options.title,
                },
              },
            ],
          },
        },
      });
    } catch {
      // 忽略标题更新非关键异常
    }
  }

  return {
    documentId,
    wikiToken,
    title: options?.title || oldTitle || "文档",
    updatedBlocks: appendRes.appendedBlocks,
    url: wikiToken
      ? `https://open.feishu.cn/wiki/${wikiToken}`
      : `https://open.feishu.cn/docx/${documentId}`,
    message: "文档正文内容已成功全量更新替换",
  };
}

/**
 * 局部更新/修改飞书文档中的指定块 (Block) 文本
 */
export async function patchDocumentBlock(
  documentIdOrUrl: string,
  blockId: string,
  newContent: string,
) {
  const client = getFeishuClient();
  const { documentId } = await resolveRealDocumentId(client, documentIdOrUrl);

  let patchRes;
  try {
    patchRes = await client.docx.documentBlock.patch({
      path: { document_id: documentId, block_id: blockId },
      data: {
        update_text_elements: {
          elements: [
            {
              text_run: {
                content: newContent,
              },
            },
          ],
        },
      },
    });
  } catch (error: any) {
    throw new Error(formatLarkError(error, `修改块内容失败 (block_id: ${blockId})`));
  }

  if (patchRes.code !== 0) {
    throw new Error(formatLarkError(patchRes, `修改块内容失败 (block_id: ${blockId})`));
  }

  return {
    documentId,
    blockId,
    content: newContent,
    url: `https://open.feishu.cn/docx/${documentId}`,
    message: "块内容修改成功",
  };
}
