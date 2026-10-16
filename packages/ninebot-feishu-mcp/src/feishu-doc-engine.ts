import * as lark from "@larksuiteoapi/node-sdk";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { getAppCredentials, getWikiConfig } from "./config";

let cachedClient: lark.Client | undefined;

export function getFeishuClient(): lark.Client {
  const { appId, appSecret } = getAppCredentials();

  if (!cachedClient) {
    cachedClient = new lark.Client({
      appId,
      appSecret,
      loggerLevel: lark.LoggerLevel.error,
      logger: {
        debug: (...args: any[]) => console.error(...args),
        info: (...args: any[]) => console.error(...args),
        warn: (...args: any[]) => console.error(...args),
        error: (...args: any[]) => console.error(...args),
        trace: (...args: any[]) => console.error(...args),
      },
    });
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

  if (/^(?:bas)[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { raw: trimmed, type: "bitable", appToken: trimmed };
  }

  if (/^(?:sht)[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { raw: trimmed, type: "sheet", appToken: trimmed };
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
    const rawObjType = nodeRes.data?.node?.obj_type as string | undefined;
    const objType =
      rawObjType === "doc" ? "docx" :
      rawObjType === "base" ? "bitable" :
      (rawObjType as "docx" | "sheet" | "bitable" | undefined);
    const title = nodeRes.data?.node?.title;

    if (!objToken) {
      throw new Error(`知识库节点 [${parsed.wikiToken}] 未找到关联的文档对象`);
    }

    return {
      objType: (objType || "docx") as "docx" | "sheet" | "bitable",
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
  const blockById = new Map<string, any>(blocks.map((b) => [b.block_id, b]));
  // 表格单元格内的子块由表格统一渲染，避免被拍平成独立段落
  const consumed = new Set<string>();
  const markConsumed = (id: string) => {
    consumed.add(id);
    for (const childId of blockById.get(id)?.children || []) markConsumed(childId);
  };

  for (const block of blocks) {
    if (consumed.has(block.block_id)) continue;
    const type = block.block_type;
    // block_type 1: page block (根块跳过)
    if (type === 1) continue;

    // 31: table（单元格为 32，单元格内再嵌套文本块）
    if (type === 31 && block.table?.cells) {
      const columnSize = block.table.property?.column_size || 1;
      const cellTexts: string[] = block.table.cells.map((cellId: string) => {
        markConsumed(cellId);
        const cell = blockById.get(cellId);
        return (cell?.children || [])
          .map((childId: string) => {
            const child = blockById.get(childId);
            return child ? convertBlocksToMarkdown([child]) : "";
          })
          .filter(Boolean)
          .join("<br>")
          .replace(/\n+/g, " ")
          .replace(/\|/g, "\\|")
          .trim();
      });
      const rows: string[] = [];
      for (let i = 0; i < cellTexts.length; i += columnSize) {
        rows.push(`| ${cellTexts.slice(i, i + columnSize).join(" | ")} |`);
        if (i === 0) rows.push(`|${" --- |".repeat(columnSize)}`);
      }
      lines.push(rows.join("\n"));
      continue;
    }

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
export type DocxImageAsset = {
  fileName: string;
  alt?: string;
  data: Buffer;
  width?: number;
  height?: number;
};

export type DocumentWriteOptions = {
  /** Source images keyed by their Markdown URL marker. */
  images?: ReadonlyMap<string, DocxImageAsset>;
};

export function parseMarkdownToDocxBlocks(markdown: string, options?: DocumentWriteOptions): Array<any> {
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

    // Confluence images are sometimes wrapped by a list item, numeric prefix,
    // bold text, or a link.  Treat every internal migration marker on such a
    // line as a native image, rather than requiring an exact `![](...)` line.
    // This preserves e.g. `[![](confluence-image://0)](url)` and
    // `1. **![](confluence-image://0)**`.
    const imageMatches = [...trimmed.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    const imageAssets = imageMatches.map((match) => options?.images?.get(match[2]));
    if (imageMatches.length > 0 && imageAssets.every(Boolean)) {
      for (const asset of imageAssets as DocxImageAsset[]) {
        blocks.push({
          block_type: 27, // image
          image: {
            ...(asset.alt ? { caption: { content: asset.alt } } : {}),
          },
          __imageAsset: asset,
        });
      }
      continue;
    }

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
        // The descendant API accepts at most 1,000 blocks.  A table needs a
        // table block plus a cell and text block for every cell, so retain
        // genuinely large tables as readable code chunks instead of sending
        // an invalid multi-thousand-block request.
        if (rows.length * columnSize > 450) {
          const tableText = rows.map((row) => row.join(" | ")).join("\n");
          for (let start = 0; start < tableText.length; start += 6000) {
            blocks.push({
              block_type: 14,
              code: { elements: [{ text_run: { content: tableText.slice(start, start + 6000) } }] },
            });
          }
          i = cursor - 1;
          continue;
        }
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

  // 优先获取真实的字段元信息（表头及字段顺序）
  let headers: string[] = [];
  try {
    const fieldsRes = await client.bitable.appTableField.list({
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 100 },
    });
    if (fieldsRes.code === 0 && fieldsRes.data?.items?.length) {
      headers = fieldsRes.data.items.map((f) => f.field_name);
    }
  } catch {
    // 降级使用记录中的 keys
  }

  // 分页拉取所有记录
  const items: Array<any> = [];
  let pageToken: string | undefined;
  do {
    let recordsRes;
    try {
      recordsRes = await client.bitable.appTableRecord.list({
        path: { app_token: appToken, table_id: tableId },
        params: {
          page_size: 500,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
    } catch (err) {
      throw new Error(formatLarkError(err, "读取多维表格记录失败"));
    }

    if (recordsRes.code !== 0) {
      throw new Error(formatLarkError(recordsRes, "读取多维表格记录失败"));
    }

    if (recordsRes.data?.items) {
      items.push(...recordsRes.data.items);
    }
    pageToken = recordsRes.data?.has_more ? recordsRes.data.page_token : undefined;
  } while (pageToken);

  if (headers.length === 0) {
    const fieldKeysSet = new Set<string>();
    items.forEach((item) => {
      Object.keys(item.fields || {}).forEach((k) => fieldKeysSet.add(k));
    });
    headers = Array.from(fieldKeysSet);
  }

  if (headers.length === 0) {
    return {
      title: bitableTitle,
      format: "markdown",
      rowCount: 0,
      content: `# ${bitableTitle}\n\n*表格暂无记录且无字段*`,
    };
  }

  const sep = headers.map(() => "---");
  const dataRows = items.map((item) => {
    const fields = (item.fields || {}) as Record<string, unknown>;
    return headers.map((h) => {
      const val = fields[h];
      if (val === undefined || val === null) return " ";
      if (typeof val === "object") {
        if (Array.isArray(val)) {
          return val.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ").replace(/\|/g, "\\|") || " ";
        }
        return JSON.stringify(val).replace(/\|/g, "\\|");
      }
      return String(val).trim().replace(/\r?\n/g, " ").replace(/\|/g, "\\|") || " ";
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
 * 将 Markdown 表格、JSON 格式或纯文本解析为多维表格记录
 */
export function parseContentToBitableRecords(
  content: string,
  availableFields?: Array<{ field_name: string; field_id?: string; is_primary?: boolean }>,
): Array<Record<string, any>> {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // 1. 尝试解析为 JSON
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed.records || parsed.items || parsed.data;
      if (Array.isArray(list)) {
        return list
          .filter((item) => item && typeof item === "object")
          .map((item) => (item.fields && typeof item.fields === "object" ? item.fields : item));
      }
    } catch {
      // 降级为表格或行文本
    }
  }

  // 2. 尝试解析 Markdown 表格
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tableLines = lines.filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableLines.length >= 2) {
    const rawHeader = tableLines[0];
    const headerCols = rawHeader
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());

    const contentRows = tableLines.slice(1).filter((line) => !isMarkdownTableSeparator(line));
    if (contentRows.length > 0) {
      return contentRows.map((line) => {
        const cells = line
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim().replace(/\\\|/g, "|"));
        const record: Record<string, any> = {};
        headerCols.forEach((colName, idx) => {
          if (colName && cells[idx] !== undefined) {
            record[colName] = cells[idx];
          }
        });
        return record;
      });
    }
  }

  // 3. 尝试解析键值对块（多条记录间用 --- 分隔）
  const records: Array<Record<string, any>> = [];
  let currentRecord: Record<string, any> = {};
  for (const line of lines) {
    if (line === "---" || line === "***") {
      if (Object.keys(currentRecord).length > 0) {
        records.push(currentRecord);
        currentRecord = {};
      }
      continue;
    }
    const colonIdx = line.indexOf(":");
    const ccolonIdx = line.indexOf("：");
    const idx =
      colonIdx > 0 && ccolonIdx > 0
        ? Math.min(colonIdx, ccolonIdx)
        : colonIdx > 0
        ? colonIdx
        : ccolonIdx;
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) {
        currentRecord[key] = val;
        continue;
      }
    }
  }
  if (Object.keys(currentRecord).length > 0) {
    records.push(currentRecord);
  }
  if (records.length > 0) {
    return records;
  }

  // 4. 纯行文本兜底：写入首个文本字段或主字段
  const primaryField =
    availableFields?.find((f) => f.is_primary)?.field_name ||
    availableFields?.[0]?.field_name ||
    "内容";
  return lines.map((l) => ({ [primaryField]: l }));
}

/**
 * 向飞书多维表格追加记录
 */
export async function appendBitableRecords(
  client: lark.Client,
  appToken: string,
  tableId: string | undefined,
  content: string,
) {
  let finalTableId = tableId;
  if (!finalTableId) {
    const tablesRes = await client.bitable.appTable.list({
      path: { app_token: appToken },
      params: { page_size: 20 },
    });
    if (tablesRes.code !== 0 || !tablesRes.data?.items?.length) {
      throw new Error(formatLarkError(tablesRes, "读取多维表格数据表失败"));
    }
    finalTableId = tablesRes.data.items[0].table_id;
  }

  if (!finalTableId) {
    throw new Error("未找到多维表格中的可用数据表 ID");
  }

  // 获取字段元信息
  let fields: Array<{ field_id: string; field_name: string; is_primary?: boolean }> = [];
  try {
    const fieldsRes = await client.bitable.appTableField.list({
      path: { app_token: appToken, table_id: finalTableId },
      params: { page_size: 100 },
    });
    if (fieldsRes.code === 0 && fieldsRes.data?.items) {
      fields = fieldsRes.data.items as any;
    }
  } catch {}

  const recordsData = parseContentToBitableRecords(content, fields);
  if (recordsData.length === 0) {
    return {
      appToken,
      tableId: finalTableId,
      appendedRecords: 0,
      message: "未解析到有效记录数据",
    };
  }

  // 检查现有记录，优先填充纯空白行（如新建表格时飞书自动生成的空行）
  const blankRecordIds: string[] = [];
  try {
    const listRes = await client.bitable.appTableRecord.list({
      path: { app_token: appToken, table_id: finalTableId },
      params: { page_size: 100 },
    });
    if (listRes.code === 0 && listRes.data?.items) {
      for (const item of listRes.data.items) {
        const itemFields = item.fields || {};
        const hasValue = Object.values(itemFields).some(
          (v) => v !== null && v !== undefined && String(v).trim() !== "",
        );
        if (!hasValue && item.record_id) {
          blankRecordIds.push(item.record_id);
        }
      }
    }
  } catch {}

  let totalAppended = 0;
  const remainingRecords = [...recordsData];

  // 1. 先填充现有的空白行
  while (blankRecordIds.length > 0 && remainingRecords.length > 0) {
    const targetRecordId = blankRecordIds.shift()!;
    const fieldsObj = remainingRecords.shift()!;
    try {
      const updateRes = await client.bitable.appTableRecord.update({
        path: { app_token: appToken, table_id: finalTableId, record_id: targetRecordId },
        data: { fields: fieldsObj },
      });
      if (updateRes.code === 0) {
        totalAppended += 1;
      }
    } catch {
      // 若更新失败，放回并在后续批量新增
      remainingRecords.unshift(fieldsObj);
      break;
    }
  }

  // 2. 剩余记录批量新增，单次上限 500 条
  const BATCH_SIZE = 500;
  for (let i = 0; i < remainingRecords.length; i += BATCH_SIZE) {
    const batch = remainingRecords.slice(i, i + BATCH_SIZE).map((fieldsObj) => ({
      fields: fieldsObj,
    }));

    const createRes = await client.bitable.appTableRecord.batchCreate({
      path: { app_token: appToken, table_id: finalTableId },
      data: { records: batch },
    });

    if (createRes.code !== 0) {
      throw new Error(
        formatLarkError(
          createRes,
          `批量创建多维表格记录失败 (app_token: ${appToken}, table_id: ${finalTableId})`,
        ),
      );
    }

    totalAppended += createRes.data?.records?.length ?? batch.length;
  }

  return {
    appToken,
    tableId: finalTableId,
    appendedRecords: totalAppended,
    message: `成功向多维表格追加 ${totalAppended} 条记录`,
  };
}

/**
 * 全量覆盖/更新飞书多维表格（清空旧记录并写入新记录）
 */
export async function updateBitableRecords(
  client: lark.Client,
  appToken: string,
  tableId: string | undefined,
  content: string,
) {
  let finalTableId = tableId;
  if (!finalTableId) {
    const tablesRes = await client.bitable.appTable.list({
      path: { app_token: appToken },
      params: { page_size: 20 },
    });
    if (tablesRes.code !== 0 || !tablesRes.data?.items?.length) {
      throw new Error(formatLarkError(tablesRes, "读取多维表格数据表失败"));
    }
    finalTableId = tablesRes.data.items[0].table_id;
  }

  if (!finalTableId) {
    throw new Error("未找到多维表格中的可用数据表 ID");
  }

  // 1. 获取现有所有记录的 record_id
  const recordIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const listRes = await client.bitable.appTableRecord.list({
      path: { app_token: appToken, table_id: finalTableId },
      params: {
        page_size: 500,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    if (listRes.code === 0 && listRes.data?.items) {
      for (const item of listRes.data.items) {
        if (item.record_id) recordIds.push(item.record_id);
      }
    }
    pageToken = listRes.data?.has_more ? listRes.data.page_token : undefined;
  } while (pageToken);

  // 2. 批量删除旧记录
  if (recordIds.length > 0) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
      const chunk = recordIds.slice(i, i + BATCH_SIZE);
      const delRes = await client.bitable.appTableRecord.batchDelete({
        path: { app_token: appToken, table_id: finalTableId },
        data: { records: chunk },
      });
      if (delRes.code !== 0) {
        throw new Error(
          formatLarkError(
            delRes,
            `批量删除多维表格记录失败 (app_token: ${appToken}, table_id: ${finalTableId})`,
          ),
        );
      }
    }
  }

  // 3. 写入新记录
  return appendBitableRecords(client, appToken, finalTableId, content);
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
  options?: DocumentWriteOptions,
) {
  const client = getFeishuClient();
  const target = await resolveDocumentTarget(client, documentIdOrUrl);

  // 如果目标是多维表格 Bitable
  if (target.objType === "bitable") {
    const bitableResult = await appendBitableRecords(
      client,
      target.token,
      target.tableId,
      content,
    );
    return {
      documentId: target.token,
      wikiToken: target.wikiToken,
      appendedBlocks: bitableResult.appendedRecords,
      url: target.wikiToken
        ? `https://open.feishu.cn/wiki/${target.wikiToken}`
        : `https://open.feishu.cn/base/${target.token}`,
      message: bitableResult.message,
    };
  }

  const documentId = target.token;

  const blocks = parseMarkdownToDocxBlocks(content, options);
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
          // __imageAsset is local bookkeeping for the upload that follows;
          // Feishu's create-block endpoint only accepts documented fields.
          data: { children: chunk.map(({ __imageAsset, ...block }) => block), index: -1 },
        });
      } catch (error: any) {
        throw new Error(formatLarkError(error, `向飞书文档写入内容失败 (document_id: ${documentId})`));
      }
      if (appendRes.code !== 0) {
        throw new Error(formatLarkError(appendRes, `向飞书文档写入内容失败 (document_id: ${documentId})`));
      }
      const createdBlocks = (appendRes.data?.children || []) as Array<{ block_id?: string }>;
      const pendingImages = chunk.flatMap((block, blockIndex) => {
        const asset = block.__imageAsset as DocxImageAsset | undefined;
        if (!asset) return [];
        const imageBlockId = createdBlocks[blockIndex]?.block_id;
        if (!imageBlockId) {
          throw new Error(`飞书未返回图片块 ID，无法上传图片「${asset.fileName}」`);
        }
        return [{ imageBlockId, asset }];
      });
      // Feishu limits concurrent edits for one document to 3 QPS. Upload and
      // bind three independent image blocks in parallel.  Leave a full rate
      // window between batches: otherwise a large document can start its
      // second batch before the first three edits have been accounted for,
      // resulting in image blocks that exist but have no bound media.
      for (let imageIndex = 0; imageIndex < pendingImages.length; imageIndex += 3) {
        await Promise.all(
          pendingImages.slice(imageIndex, imageIndex + 3).map(({ imageBlockId, asset }) =>
            uploadDocxImage(client, documentId, imageBlockId, asset),
          ),
        );
        if (imageIndex + 3 < pendingImages.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1100));
        }
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
    // Table creation is also a document edit.  Spacing consecutive table
    // requests keeps table-heavy Wiki pages below Feishu's edit-rate limit.
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    totalAppended += 1;
  }
  await flushRegularBlocks();

  return {
    documentId,
    appendedBlocks: totalAppended,
    url: `https://open.feishu.cn/docx/${documentId}`,
  };
}

async function uploadDocxImage(
  client: lark.Client,
  documentId: string,
  imageBlockId: string,
  asset: DocxImageAsset,
) {
  let uploadResult;
  try {
    uploadResult = await client.drive.media.uploadAll({
      data: {
        file_name: asset.fileName,
        parent_type: "docx_image",
        parent_node: imageBlockId,
        size: asset.data.length,
        file: asset.data,
      },
    });
  } catch (error: any) {
    throw new Error(formatLarkError(error, `上传飞书图片素材失败「${asset.fileName}」`));
  }
  const token = uploadResult?.file_token;
  if (!token) throw new Error(`上传飞书图片素材失败「${asset.fileName}」：未返回素材 token`);

  try {
    const patchResult = await client.docx.documentBlock.patch({
      path: { document_id: documentId, block_id: imageBlockId },
      data: {
        replace_image: {
          token,
          // Confluence often stores only one dimension (for example just
          // height="250"). Supplying that single edge to Feishu can distort
          // the aspect ratio, so let Feishu derive both dimensions from the
          // uploaded image itself.
          ...(asset.alt ? { caption: { content: asset.alt } } : {}),
        },
      },
    });
    if (patchResult.code !== 0) throw patchResult;
  } catch (error: any) {
    throw new Error(formatLarkError(error, `绑定飞书图片块失败「${asset.fileName}」`));
  }
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
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const createRes = await client.docx.documentBlockDescendant.create({
        path: { document_id: documentId, block_id: documentId },
        data: { children_id: [tableId], descendants, index: -1 },
      });
      if (createRes.code !== 0) throw createRes;
      return;
    } catch (error: any) {
      lastError = error;
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw new Error(formatLarkError(lastError, `创建飞书表格失败 (document_id: ${documentId})`));
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

async function listDocumentBlocks(client: lark.Client, documentId: string): Promise<Array<any>> {
  const blocks: Array<any> = [];
  let pageToken: string | undefined;

  do {
    let response;
    try {
      response = await client.docx.documentBlock.list({
        path: { document_id: documentId },
        params: {
          page_size: 500,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
    } catch (error: any) {
      throw new Error(formatLarkError(error, `读取飞书文档块失败 (document_id: ${documentId})`));
    }

    if (response.code !== 0) {
      throw new Error(formatLarkError(response, `读取飞书文档块失败 (document_id: ${documentId})`));
    }

    blocks.push(...(response.data?.items ?? []));
    pageToken = response.data?.has_more ? response.data.page_token : undefined;
  } while (pageToken);

  return blocks;
}

function cloneDocumentBlockGroups(sourceBlocks: Array<any>, sourceDocumentId: string) {
  const rootBlock =
    sourceBlocks.find((block) => block.block_id === sourceDocumentId) ??
    sourceBlocks.find((block) => block.block_type === 1);

  if (!rootBlock?.block_id) {
    throw new Error(`未找到源文档根块 (document_id: ${sourceDocumentId})`);
  }

  const sourceBlocksById = new Map<string, any>();
  for (const block of sourceBlocks) {
    if (block.block_id && block.block_id !== rootBlock.block_id) {
      sourceBlocksById.set(block.block_id, block);
    }
  }

  const rootChildIds = (rootBlock.children ?? []).filter((id: string) => sourceBlocksById.has(id));
  if (rootChildIds.length === 0) return [];

  const newBlockIds = new Map<string, string>();
  for (const sourceId of sourceBlocksById.keys()) {
    newBlockIds.set(sourceId, `doxcn${randomUUID().replace(/-/g, "").slice(0, 24)}`);
  }

  const cloneValue = (value: any, key?: string): any => {
    if (Array.isArray(value)) {
      return value.map((item) => cloneValue(item, key));
    }
    if (!value || typeof value !== "object") {
      if (key === "block_id" && typeof value === "string") return newBlockIds.get(value) ?? value;
      return value;
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([childKey]) =>
            childKey !== "parent_id" &&
            childKey !== "merge_info" &&
            childKey !== "cells",
        )
        .map(([childKey, childValue]) => {
          if (childKey === "block_id" && typeof childValue === "string") {
            return [childKey, newBlockIds.get(childValue) ?? childValue];
          }
          if (childKey === "children" && Array.isArray(childValue)) {
            return [childKey, childValue.map((id) => newBlockIds.get(id) ?? id)];
          }
          return [childKey, cloneValue(childValue, childKey)];
        }),
    );
  };

  const collectSubtree = (blockId: string, visited = new Set<string>()): Array<any> => {
    if (visited.has(blockId)) return [];
    visited.add(blockId);
    const block = sourceBlocksById.get(blockId);
    if (!block) return [];
    return [block, ...(block.children ?? []).flatMap((childId: string) => collectSubtree(childId, visited))];
  };

  const groups: Array<{ childrenId: string[]; descendants: Array<any> }> = [];
  let groupSourceBlocks: Array<any> = [];
  let groupRootIds: string[] = [];

  const flush = () => {
    if (!groupSourceBlocks.length) return;
    groups.push({
      childrenId: groupRootIds.map((id) => newBlockIds.get(id)!),
      descendants: groupSourceBlocks.map((block) => cloneValue(block)),
    });
    groupSourceBlocks = [];
    groupRootIds = [];
  };

  for (const rootChildId of rootChildIds) {
    const subtree = collectSubtree(rootChildId);
    if (subtree.length > 1000) {
      throw new Error("周报模板包含超过 1000 个连续嵌套块，无法一次保留原始格式复制");
    }
    if (groupSourceBlocks.length + subtree.length > 1000) flush();
    groupRootIds.push(rootChildId);
    groupSourceBlocks.push(...subtree);
  }
  flush();

  return groups;
}

/**
 * 以飞书原始块结构覆盖目标文档，保留表格、富文本和块级样式。
 */
export async function copyDocumentContent(
  sourceDocumentIdOrUrl: string,
  targetDocumentIdOrUrl: string,
  options?: { title?: string },
) {
  const client = getFeishuClient();
  const source = await resolveRealDocumentId(client, sourceDocumentIdOrUrl);
  const target = await resolveRealDocumentId(client, targetDocumentIdOrUrl);
  const sourceBlocks = await listDocumentBlocks(client, source.documentId);
  const groups = cloneDocumentBlockGroups(sourceBlocks, source.documentId);

  await clearDocumentChildren(client, target.documentId);

  for (const group of groups) {
    let response;
    try {
      response = await client.docx.documentBlockDescendant.create({
        path: { document_id: target.documentId, block_id: target.documentId },
        data: {
          children_id: group.childrenId,
          descendants: group.descendants,
          index: -1,
        },
      });
    } catch (error: any) {
      throw new Error(formatLarkError(error, `复制飞书文档原始格式失败 (document_id: ${target.documentId})`));
    }
    if (response.code !== 0) {
      throw new Error(formatLarkError(response, `复制飞书文档原始格式失败 (document_id: ${target.documentId})`));
    }
  }

  if (options?.title) {
    try {
      await client.docx.documentBlock.patch({
        path: { document_id: target.documentId, block_id: target.documentId },
        data: {
          update_text_elements: {
            elements: [{ text_run: { content: options.title } }],
          },
        },
      });
    } catch {
      // 标题更新失败不影响正文复制
    }
  }

  return {
    documentId: target.documentId,
    wikiToken: target.wikiToken,
    title: options?.title || target.title || "文档",
    copiedBlocks: sourceBlocks.length - 1,
    url: target.wikiToken
      ? `https://open.feishu.cn/wiki/${target.wikiToken}`
      : `https://open.feishu.cn/docx/${target.documentId}`,
  };
}

/**
 * 全量更新/覆盖飞书文档内容（清空旧正文并写入全新 Markdown）
 */
export async function updateDocumentContent(
  documentIdOrUrl: string,
  newContent: string,
  options?: { title?: string } & DocumentWriteOptions,
) {
  const client = getFeishuClient();
  const target = await resolveDocumentTarget(client, documentIdOrUrl);

  // 如果目标是多维表格 Bitable
  if (target.objType === "bitable") {
    const bitableResult = await updateBitableRecords(
      client,
      target.token,
      target.tableId,
      newContent,
    );
    return {
      documentId: target.token,
      wikiToken: target.wikiToken,
      title: options?.title || target.title || "多维表格",
      updatedBlocks: bitableResult.appendedRecords,
      url: target.wikiToken
        ? `https://open.feishu.cn/wiki/${target.wikiToken}`
        : `https://open.feishu.cn/base/${target.token}`,
      message: bitableResult.message,
    };
  }

  const documentId = target.token;
  const wikiToken = target.wikiToken;
  const oldTitle = target.title;

  // 1. 清空所有旧子块
  await clearDocumentChildren(client, documentId);

  // 2. 写入全新的 Markdown 内容
  const appendRes = await appendDocumentContent(documentId, newContent, options);

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

function getWikiObjTypeName(type: number | string): string {
  switch (Number(type)) {
    case 1:
      return "doc";
    case 2:
      return "sheet";
    case 3:
      return "bitable";
    case 4:
      return "mindnote";
    case 5:
      return "file";
    case 6:
      return "slide";
    case 7:
      return "wiki";
    case 8:
      return "docx";
    default:
      return String(type || "unknown");
  }
}

export interface WikiSpaceItem {
  spaceId: string;
  name: string;
  description: string;
  spaceType?: string;
  visibility?: string;
}

/**
 * 列出当前应用/机器人有权限访问的飞书知识库空间列表
 */
export async function listWikiSpaces(pageSize: number = 20): Promise<{
  spaces: WikiSpaceItem[];
  hasMore: boolean;
}> {
  const client = getFeishuClient();
  try {
    const res = await client.wiki.space.list({
      params: {
        page_size: pageSize,
      },
    });

    if (res.code !== 0) {
      throw new Error(formatLarkError(res, "获取知识库空间列表失败"));
    }

    const items = (res.data?.items || []).map((s: any) => ({
      spaceId: s.space_id,
      name: s.name,
      description: s.description || "",
      spaceType: s.space_type,
      visibility: s.visibility,
    }));

    return {
      spaces: items,
      hasMore: Boolean(res.data?.has_more),
    };
  } catch (error: any) {
    throw new Error(formatLarkError(error, "获取知识库空间列表失败"));
  }
}

export interface WikiSearchItem {
  wikiToken?: string;
  documentId?: string;
  title: string;
  summary?: string;
  url: string;
  objType: string;
  spaceId?: string;
  ownerName?: string;
  updateTime?: string;
}

export interface WikiSearchOutput {
  query: string;
  total: number;
  hasMore: boolean;
  spaceId?: string;
  parentNodeToken?: string;
  indexNodeToken?: string;
  items: WikiSearchItem[];
  source: string;
  message?: string;
}

// ==================== 团队权威索引（类 llms.txt） ====================

export interface TeamIndexEntry {
  /** 所在章节标题，如「📦 2. 基础库与公共能力」 */
  category: string;
  /** 表格行内除链接外的全部文本（类别、关键词、执行要求），用于匹配 */
  rowText: string;
  linkTitle: string;
  linkUrl: string;
}

export interface TeamIndex {
  token: string;
  title: string;
  url: string;
  /** 索引页完整 Markdown，直接交给 Agent 做语义判断 */
  content: string;
  entries: TeamIndexEntry[];
}

const INDEX_CACHE_TTL_MS = 10 * 60 * 1000;
let teamIndexCache: { time: number; index: TeamIndex } | null = null;

function extractWikiToken(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.match(/\/wiki\/([0-9a-zA-Z_-]+)/)?.[1] || trimmed;
}

/** 飞书网页域名：优先取索引中链接的租户域名，保证返回给人的链接可直接打开 */
function getWebOrigin(): string {
  const firstLink = teamIndexCache?.index.entries[0]?.linkUrl;
  if (firstLink) {
    try {
      return new URL(firstLink).origin;
    } catch {
      // ignore
    }
  }
  return "https://open.feishu.cn";
}

function parseIndexEntries(markdown: string): TeamIndexEntry[] {
  const entries: TeamIndexEntry[] = [];
  let category = "";
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^#{2,6}\s+(.+)/);
    if (heading) {
      category = heading[1].trim();
      continue;
    }
    // 表格已由 convertBlocksToMarkdown 渲染为一行一条记录，按行解析即可，不会串行
    if (!line.startsWith("|")) continue;
    const links = [...line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)];
    if (!links.length) continue;
    const rowText = line
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<br>|[|*`]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    for (const [, linkTitle, linkUrl] of links) {
      entries.push({ category, rowText, linkTitle, linkUrl });
    }
  }
  return entries;
}

/**
 * 读取团队权威索引页（默认取 FEISHU_WIKI_INDEX_NODE_TOKEN），带 10 分钟缓存
 */
export async function getTeamIndex(indexToken?: string, forceRefresh = false): Promise<TeamIndex | null> {
  const token = extractWikiToken(indexToken || getWikiConfig().indexNodeToken);
  if (!token) return null;
  if (
    !forceRefresh &&
    teamIndexCache?.index.token === token &&
    Date.now() - teamIndexCache.time < INDEX_CACHE_TTL_MS
  ) {
    return teamIndexCache.index;
  }
  const doc = await readDocument(token);
  const content = doc.content || "";
  const entries = parseIndexEntries(content);
  teamIndexCache = {
    time: Date.now(),
    index: { token, title: doc.title || "团队索引", url: "", content, entries },
  };
  teamIndexCache.index.url = `${getWebOrigin()}/wiki/${token}`;
  return teamIndexCache.index;
}

// ==================== 检索词提取与打分 ====================

// 口语化的动作词与助词：不参与匹配，并作为短语切分点
const STOP_WORDS = [
  "请帮我", "帮我", "帮忙", "请问", "麻烦", "一下", "检索", "搜索", "查询", "查找", "查看", "查下", "查一查",
  "找到", "找下", "找一下", "如何", "怎样", "怎么样", "怎么", "哪些", "什么", "是否", "可以", "需要", "应该",
  "配置", "安装", "接入", "使用", "执行", "实施", "落地", "关于", "以及", "并且", "然后", "知识库", "文档",
  "资料", "团队", "我们", "我", "的", "了", "和", "与", "吗", "呢",
];
const SORTED_STOP_WORDS = [...STOP_WORDS].sort((a, b) => b.length - a.length);
// 高频泛化词及由其组成的复合词（如「前端规范」「工程标准」）：单命中加低分，只有全为泛化词时才算总览检索
const GENERIC_WORDS = ["前端", "规范", "标准", "指南", "方案", "说明", "工程化", "工程", "项目", "最佳实践", "手册", "总览", "导航", "索引"];
const zhSegmenter = new Intl.Segmenter("zh", { granularity: "word" });

function isGenericTerm(term: string): boolean {
  let rest = term;
  for (const word of GENERIC_WORDS) rest = rest.split(word).join("");
  return rest.length === 0;
}

/**
 * 从自然语言中提取检索词：技术英文词 + 去停用词后的中文短语 + Intl.Segmenter 中文分词（含单字词缀合并）
 */
export function extractSearchTerms(query: string): string[] {
  const lower = query.toLowerCase();
  const terms = new Set<string>();
  const add = (term: string) => {
    const t = term.trim();
    if (t.length >= 2 && !STOP_WORDS.includes(t)) terms.add(t);
  };

  // 1. 英文 / 数字技术词（eslint、@ninebot/eslint-config、cicd）
  for (const word of lower.match(/[a-z0-9@][a-z0-9_.@/-]*/g) || []) add(word);

  // 2. 以停用词和标点切分出的中文连续短语（保留「动态路由」这类分词器会切碎的词）
  let chunked = lower;
  for (const stopWord of SORTED_STOP_WORDS) chunked = chunked.split(stopWord).join(" ");
  const phrases = chunked.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const phrase of phrases) {
    add(phrase);
    // 3. 中文分词 + 单字前后缀合并（解决「组件+库+升级」漏掉「组件库」、「微+前端」漏掉「微前端」的问题）
    const segs = [...zhSegmenter.segment(phrase)]
      .filter((x) => x.isWordLike && /[\u4e00-\u9fa5]/.test(x.segment))
      .map((x) => x.segment);
    for (let i = 0; i < segs.length; i++) {
      add(segs[i]);
      if (i + 1 < segs.length && (segs[i].length === 1 || segs[i + 1].length === 1)) {
        add(segs[i] + segs[i + 1]);
      }
      if (i + 2 < segs.length && segs[i + 1].length === 1 && segs[i + 2].length === 1) {
        add(segs[i + 1] + segs[i + 2]);
        add(segs[i] + segs[i + 1] + segs[i + 2]);
      }
    }
  }

  return terms.size ? [...terms] : [lower.trim()];
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score += isGenericTerm(term) ? 0.3 : Math.min(term.length, 6);
  }
  return score;
}

/** 至少命中一个非泛化词才算相关；若检索词全是泛化词（如「前端规范」）则放宽 */
function minRelevantScore(terms: string[]) {
  return terms.every(isGenericTerm) ? 0.3 : 1;
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/\.(docx?|pdf|xlsx?|pptx?)$/, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

// ==================== 知识库目录树 ====================

type WikiNode = { node_token: string; obj_token: string; title: string; obj_type: any };

const CACHE_TTL_MS = 15 * 60 * 1000;
const spaceCatalogCache = new Map<string, { time: number; nodes: WikiNode[] }>();
const parentResolveCache = new Map<string, { time: number; token: string; spaceId?: string; node?: WikiNode }>();
const ARCHIVE_BRANCH_PATTERN = /周报|上线记录|绩效复盘|交接记录/;

/** 轻量并发控制器（最多 6 个并发请求，避免冷启动串行耗时过长同时不触发飞书频控） */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
const wikiApiLimit = createLimiter(6);

async function listChildNodes(client: lark.Client, spaceId: string, parentToken?: string) {
  const nodes: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await wikiApiLimit(() =>
      client.wiki.spaceNode.list({
        path: { space_id: spaceId },
        params: { parent_node_token: parentToken, page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
      }),
    );
    nodes.push(...(res.data?.items || []));
    pageToken = res.data?.has_more ? res.data.page_token : undefined;
  } while (pageToken);
  return nodes;
}

/**
 * 并发递归收集目录子树（带缓存）。全空间遍历时跳过周报等大型归档分支
 */
async function collectSubtree(
  client: lark.Client,
  spaceId: string,
  root: { token?: string; node?: WikiNode },
  skipArchive: boolean,
): Promise<WikiNode[]> {
  const cacheKey = `${spaceId}:${root.token || "root"}:${skipArchive ? "skip" : "all"}`;
  const cached = spaceCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.nodes;

  const collected: WikiNode[] = root.node ? [root.node] : [];
  async function walk(parentToken: string | undefined, depth: number) {
    if (depth > 6) return;
    const children = await listChildNodes(client, spaceId, parentToken);
    const subTasks: Promise<void>[] = [];
    for (const node of children) {
      if (!node.node_token) continue;
      collected.push({
        node_token: node.node_token,
        obj_token: node.obj_token || "",
        title: node.title || "",
        obj_type: node.obj_type,
      });
      if (node.has_child && !(skipArchive && ARCHIVE_BRANCH_PATTERN.test(node.title || ""))) {
        subTasks.push(walk(node.node_token, depth + 1));
      }
    }
    if (subTasks.length) await Promise.all(subTasks);
  }
  await walk(root.token, 0);
  spaceCatalogCache.set(cacheKey, { time: Date.now(), nodes: collected });
  return collected;
}

/**
 * 解析父目录：支持 Wiki Token、URL 或空间根目录名称（结果缓存，避免每次检索都请求接口）
 */
async function resolveParentNode(client: lark.Client, raw: string, spaceId?: string) {
  const cacheKey = `${spaceId || ""}:${raw}`;
  const cached = parentResolveCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached;

  const token = extractWikiToken(raw) || raw;
  let result: { token: string; spaceId?: string; node?: WikiNode } = { token, spaceId };
  try {
    const res = await wikiApiLimit(() => client.wiki.space.getNode({ params: { token, obj_type: "wiki" } }));
    const node = res.data?.node;
    if (node?.node_token) {
      result = {
        token: node.node_token,
        spaceId: spaceId || node.space_id,
        node: { node_token: node.node_token, obj_token: node.obj_token || "", title: node.title || "", obj_type: node.obj_type },
      };
    }
  } catch {
    // 非 Token，尝试按目录名称匹配
  }

  if (!result.node && spaceId) {
    const keyword = raw.toLowerCase();
    const matched = (await listChildNodes(client, spaceId)).find((item: any) =>
      item.title?.toLowerCase().includes(keyword),
    );
    if (matched?.node_token) {
      result = {
        token: matched.node_token,
        spaceId,
        node: { node_token: matched.node_token, obj_token: matched.obj_token || "", title: matched.title || "", obj_type: matched.obj_type },
      };
    }
  }

  const entry = { time: Date.now(), ...result };
  parentResolveCache.set(cacheKey, entry);
  return entry;
}

async function resolveSpaceId(client: lark.Client, value?: string) {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.includes("/wiki/")) return trimmed;
  const spaceMatch = trimmed.match(/\/wiki\/space\/([0-9a-zA-Z_-]+)/);
  if (spaceMatch) return spaceMatch[1];
  try {
    const res = await client.wiki.space.getNode({ params: { token: extractWikiToken(trimmed)!, obj_type: "wiki" } });
    return res.data?.node?.space_id || trimmed;
  } catch {
    return trimmed;
  }
}

/** 飞书官方全文搜索（需 search:docs:read 权限），仅在未限定目录时使用 */
async function searchByOfficialEngine(client: lark.Client, query: string, spaceId: string | undefined, pageSize: number) {
  const res = await client.search.v2.docWiki.search({
    data: { query, wiki_filter: spaceId ? { space_ids: [spaceId] } : undefined, page_size: pageSize },
  });
  if (res.code !== 0) return [];
  return (res.data?.res_units || []).map((unit: any): WikiSearchItem => {
    const meta = unit.result_meta || {};
    const token = meta.token;
    const isWiki = unit.entity_type === "WIKI" || meta.doc_types === "WIKI";
    return {
      wikiToken: isWiki ? token : undefined,
      documentId: isWiki ? undefined : token,
      title: (unit.title_highlighted || token || "无标题").replace(/<[^>]+>/g, "").trim(),
      summary: (unit.summary_highlighted || "").replace(/<[^>]+>/g, "").trim(),
      url: meta.url || (token ? `${getWebOrigin()}/${isWiki ? "wiki" : "docx"}/${token}` : ""),
      objType: meta.doc_types || unit.entity_type || "docx",
      ownerName: meta.owner_name,
      updateTime: meta.update_time ? new Date(meta.update_time * 1000).toLocaleString() : undefined,
    };
  });
}

function linkToSearchItem(linkUrl: string) {
  const wikiToken = linkUrl.match(/\/wiki\/([0-9a-zA-Z_-]+)/)?.[1];
  const documentId = wikiToken ? undefined : linkUrl.match(/\/(?:docx|docs|sheets|base)\/([0-9a-zA-Z_-]+)/)?.[1];
  const objType = wikiToken ? "wiki" : linkUrl.match(/\/(docx|docs|sheets|base)\//)?.[1] || "link";
  return { wikiToken, documentId, objType };
}

// ==================== 检索入口 ====================

/**
 * 在飞书知识库中检索文档。
 * 优先级：团队权威索引（行级匹配） > 官方全文搜索（未限定目录时） > 限定目录的标题匹配。
 */
export async function searchWiki(
  query: string,
  options?: {
    spaceId?: string;
    parentNodeToken?: string;
    indexNodeToken?: string;
    pageSize?: number;
  },
): Promise<WikiSearchOutput> {
  const client = getFeishuClient();
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    throw new Error("搜索关键词不能为空");
  }

  const pageSize = Math.min(Math.max(options?.pageSize || 10, 1), 50);
  const terms = extractSearchTerms(trimmedQuery);
  const isOverviewQuery = terms.every(isGenericTerm);
  const minScore = minRelevantScore(terms);
  const notices: string[] = [];

  const wikiConfig = getWikiConfig();
  const parentInputs = (options?.parentNodeToken || wikiConfig.parentNodeTokens || "")
    .split(/[,，;；]/)
    .map((t) => t.trim())
    .filter(Boolean);

  // 1. 并发加载团队索引与解析目标空间 / 父目录
  const [teamIndex, initialSpaceId] = await Promise.all([
    getTeamIndex(options?.indexNodeToken || wikiConfig.indexNodeToken).catch((error: any) => {
      notices.push(`团队索引读取失败（请检查机器人是否有该文档阅读权限）：${error.message || String(error)}`);
      return null;
    }),
    resolveSpaceId(client, options?.spaceId || wikiConfig.spaceId),
  ]);

  let spaceId = initialSpaceId;
  const parents = await Promise.all(parentInputs.map((raw) => resolveParentNode(client, raw, spaceId)));
  for (const parent of parents) {
    spaceId = spaceId || parent.spaceId;
  }

  // 2. 团队权威索引：按表格行打分，命中项置顶
  const indexItems: WikiSearchItem[] = [];
  if (teamIndex) {
    if (isOverviewQuery) {
      indexItems.push({
        wikiToken: teamIndex.token,
        title: `📌 [团队权威索引] ${teamIndex.title}`,
        summary: "团队工程规范、基础库、SDK 与最佳实践的唯一权威导航索引",
        url: teamIndex.url,
        objType: "wiki",
      });
    }
    const scored = teamIndex.entries
      .map((entry) => ({ entry, score: scoreText(`${entry.linkTitle} ${entry.rowText}`, terms) }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score);
    for (const { entry } of scored) {
      indexItems.push({
        ...linkToSearchItem(entry.linkUrl),
        title: `⭐ [团队索引推荐] ${entry.linkTitle}`,
        summary: `${entry.category ? `${entry.category} | ` : ""}${entry.rowText}`,
        url: entry.linkUrl,
      });
    }
  }

  // 3. 目录树 / 官方搜索
  const treeItems: WikiSearchItem[] = [];
  let source = parents.length ? "directory_title_match" : "space_title_match";
  try {
    let officialItems: WikiSearchItem[] = [];
    if (!parents.length) {
      try {
        officialItems = await searchByOfficialEngine(client, trimmedQuery, spaceId, pageSize);
      } catch (error: any) {
        const message = formatLarkError(error, "调用飞书搜索引擎失败");
        if (message.includes("99991672") || message.includes("search:docs:read")) {
          notices.push(
            `飞书官方全文搜索需开通 search:docs:read 权限：https://open.feishu.cn/app/${process.env.FEISHU_APP_ID}/auth?q=search:docs:read&op_from=openapi&token_type=tenant`,
          );
        }
      }
    }

    if (officialItems.length) {
      source = "doc_wiki_search";
      treeItems.push(...officialItems);
    } else {
      const spaceIds = spaceId
        ? [spaceId]
        : ((await client.wiki.space.list({ params: { page_size: 20 } })).data?.items || [])
            .map((s: any) => s.space_id)
            .filter(Boolean);
      const isArchiveQuery = terms.some((t) => /周报|上线|复盘|交接|报销/.test(t));
      const scoredNodes: Array<{ node: WikiNode; spaceId: string; score: number }> = [];

      for (const sid of spaceIds) {
        const roots = parents.length ? parents.map((p) => ({ token: p.token, node: p.node })) : [{}];
        const subtrees = await Promise.all(
          roots.map((root) => collectSubtree(client, sid, root, !parents.length && !isArchiveQuery)),
        );
        for (const nodes of subtrees) {
          for (const node of nodes) {
            const score = scoreText(node.title, terms);
            if (score >= minScore) scoredNodes.push({ node, spaceId: sid, score });
          }
        }
      }

      scoredNodes.sort((a, b) => b.score - a.score);
      for (const { node, spaceId: sid } of scoredNodes) {
        treeItems.push({
          wikiToken: node.node_token,
          documentId: node.obj_token,
          title: node.title,
          url: `${getWebOrigin()}/wiki/${node.node_token}`,
          objType: getWikiObjTypeName(node.obj_type),
          spaceId: sid,
        });
      }
    }
  } catch (error: any) {
    notices.push(`知识库目录检索失败：${error.message || String(error)}`);
  }

  // 4. 合并：索引直接命中项在前，其次目录命中项；按 Token 与归一化标题去重（同一文档的 docx 与 wiki 副本只保留一条）
  const items: WikiSearchItem[] = [];
  const seenTokens = new Set<string>();
  const seenTitles = new Set<string>();
  for (const item of [...indexItems, ...treeItems]) {
    const tokens = [item.wikiToken, item.documentId].filter(Boolean) as string[];
    const titleKey = normalizeTitle(item.title.replace(/^(⭐|📌) \[[^\]]+\] /, ""));
    if (tokens.some((t) => seenTokens.has(t)) || (titleKey && seenTitles.has(titleKey))) continue;
    tokens.forEach((t) => seenTokens.add(t));
    if (titleKey) seenTitles.add(titleKey);
    items.push(item);
    if (items.length >= pageSize) break;
  }

  const hasIndexHit = indexItems.length > 0;
  const fallbackIndexHint =
    !items.length && teamIndex
      ? `（可调用 feishu_get_team_index 查阅《${teamIndex.title}》 ${teamIndex.url} 确认是否有相关规范）`
      : "";
  return {
    query: trimmedQuery,
    total: items.length,
    hasMore: false,
    spaceId,
    parentNodeToken: parents.map((p) => p.token).join(",") || undefined,
    indexNodeToken: teamIndex?.token,
    items,
    source: items.length ? (hasIndexHit ? `team_index+${source}` : source) : "none",
    message: notices.length
      ? notices.join("\n")
      : items.length
        ? undefined
        : `在飞书知识库中未检索到与 "${trimmedQuery}" 匹配的文档（检索词：${terms.join("、")}）${fallbackIndexHint}`,
  };
}
