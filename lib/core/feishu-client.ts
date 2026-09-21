import * as lark from "@larksuiteoapi/node-sdk";
import fs from "fs";
import path from "path";
import { FeishuMessagePayload, RotationMember } from "./types";

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;

let cachedClient: lark.Client | undefined;

type SourceRotationMember = RotationMember & { email?: string; mobile?: string };
type FeishuUserCache = Record<string, string>;

const USER_CACHE_FILE = path.join(process.cwd(), "data", "feishu-user-cache.json");
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const MOBILE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d{9}/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeMobile(mobile: string): string {
  return mobile.trim().replace(/[\s-]/g, "");
}

function readUserCache(): FeishuUserCache {
  try {
    if (fs.existsSync(USER_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USER_CACHE_FILE, "utf-8")) as FeishuUserCache;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (error) {
    console.error("读取 data/feishu-user-cache.json 失败，将重新查询飞书用户 ID:", error);
  }
  return {};
}

function writeUserCache(cache: FeishuUserCache) {
  try {
    fs.mkdirSync(path.dirname(USER_CACHE_FILE), { recursive: true });
    const tempFile = `${USER_CACHE_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf-8");
    fs.renameSync(tempFile, USER_CACHE_FILE);
  } catch (error) {
    console.error("保存 data/feishu-user-cache.json 失败:", error);
  }
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") return String(item);
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return String(record.text ?? record.name ?? record.value ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function parseSourceRow(line: string): SourceRotationMember | undefined {
  const text = line.trim();
  if (!text) return undefined;

  const emailMatch = text.match(EMAIL_PATTERN);
  const mobileMatch = text.match(MOBILE_PATTERN);
  const openIdMatch = text.match(/ou_[\w-]+/);
  const identityIndexes = [emailMatch?.index, mobileMatch?.index, openIdMatch?.index].filter(
    (index): index is number => index !== undefined,
  );
  const identityEnd = identityIndexes.length > 0 ? Math.min(...identityIndexes) : undefined;
  const name = text
    .slice(0, identityEnd ?? text.length)
    .split(/[|｜\t,]/)[0]
    .trim();

  if (!name) return undefined;
  return {
    name,
    email: emailMatch?.[0] ? normalizeEmail(emailMatch[0]) : undefined,
    mobile: mobileMatch?.[0] ? normalizeMobile(mobileMatch[0]) : undefined,
    openId: openIdMatch?.[0],
  };
}

async function resolveRotationOpenIds(
  client: lark.Client,
  members: SourceRotationMember[],
): Promise<RotationMember[]> {
  const cache = readUserCache();
  const identitiesToQuery = members
    .filter((member) => !member.openId && (member.email || member.mobile))
    .map((member) => ({
      email: member.email ? normalizeEmail(member.email) : undefined,
      mobile: member.mobile ? normalizeMobile(member.mobile) : undefined,
    }))
    .filter(({ email, mobile }) => !cache[email || ""] && !cache[mobile || ""]);

  for (let index = 0; index < identitiesToQuery.length; index += 50) {
    const identities = identitiesToQuery.slice(index, index + 50);
    let response;
    try {
      response = await client.contact.user.batchGetId({
        params: { user_id_type: "open_id" },
        data: {
          emails: identities.flatMap(({ email }) => (email ? [email] : [])),
          mobiles: identities.flatMap(({ mobile }) => (mobile ? [mobile] : [])),
        },
      });
    } catch (error) {
      const apiError = error as { response?: { data?: { code?: number; msg?: string } } };
      const detail = apiError.response?.data;
      throw new Error(
        detail?.msg || "通过邮箱查询飞书用户 ID 失败，请确认 contact:user.id:readonly 权限已申请并发布",
      );
    }
    if (response.code !== 0) {
      throw new Error(response.msg || "通过邮箱查询飞书用户 ID 失败，请确认 contact:user.id:readonly 权限");
    }
    for (const user of response.data?.user_list ?? []) {
      if (user.email && user.user_id) cache[normalizeEmail(user.email)] = user.user_id;
      if (user.mobile && user.user_id) cache[normalizeMobile(user.mobile)] = user.user_id;
    }
  }

  // 飞书的批量接口对部分企业邮箱不会返回 user_id，
  // 再从应用可见的通讯录用户列表中按邮箱/手机号字段兜底匹配。
  const stillMissing = identitiesToQuery.filter(({ email, mobile }) => !cache[email || ""] && !cache[mobile || ""]);
  if (stillMissing.length > 0) {
    let pageToken: string | undefined;
    do {
      let response;
      try {
        response = await client.contact.user.list({
          params: {
            user_id_type: "open_id",
            page_size: 100,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
      } catch {
        break;
      }
      if (response.code !== 0) break;
      for (const user of response.data?.items ?? []) {
        const openId = user.user_id || user.open_id;
        if (!openId) continue;
        for (const email of [user.email, user.enterprise_email]) {
          if (email) cache[normalizeEmail(email)] = openId;
        }
        if (user.mobile) cache[normalizeMobile(user.mobile)] = openId;
      }
      pageToken = response.data?.has_more ? response.data.page_token : undefined;
    } while (pageToken);
  }

  if (identitiesToQuery.length > 0) writeUserCache(cache);

  // 空邮箱的联系人先保留在轮值名单中，等补齐邮箱后再解析；
  // 只有已填写邮箱但查询不到 ID 时才阻止同步，方便先验证单个联系人。
  const unresolved = members.filter((member) => {
    if (member.openId || !member.email) return false;
    return !(
      (member.email && cache[normalizeEmail(member.email)]) ||
      (member.mobile && cache[normalizeMobile(member.mobile)])
    );
  });
  if (unresolved.length > 0) {
    const details = unresolved.map((member) => {
      const identity = member.email || member.mobile;
      return `${member.name}${identity ? `（${identity}）` : "（缺少邮箱或手机号）"}`;
    });
    throw new Error(
      `邮箱已读取，但飞书未返回以下联系人的 user_id：${details.join("、")}。请确认应用已开通 contact:user.id:readonly；若使用企业邮箱兜底匹配，还需开通 contact:contact.base:readonly，并重新发布应用。`,
    );
  }

  return members.map(({ email, mobile, openId, name }) => ({
    name,
    openId: openId || (email ? cache[normalizeEmail(email)] : undefined) || (mobile ? cache[normalizeMobile(mobile)] : undefined),
  }));
}

export function getLarkClient(): lark.Client | undefined {
  if (!appId || !appSecret) return undefined;
  if (!cachedClient) {
    cachedClient = new lark.Client({ appId, appSecret });
  }
  return cachedClient;
}

/**
 * 发送飞书 Webhook 消息
 */
export async function sendWebhookMessage(
  webhookUrl: string,
  payload: FeishuMessagePayload,
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl) throw new Error("Webhook URL 不能为空");

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as { code?: number; msg?: string };
  if (!response.ok || result.code !== 0) {
    throw new Error(result.msg || "飞书消息发送失败");
  }

  return { ok: true };
}

/**
 * 解析飞书文档、知识库或表格 URL
 */
export function parseFeishuUrl(urlOrToken: string): {
  type: "wiki" | "bitable" | "docx" | "sheet" | "token";
  wikiToken?: string;
  appToken?: string;
  tableId?: string;
  sheetId?: string;
  documentId?: string;
} {
  const trimmed = urlOrToken.trim();
  if (trimmed.includes("/wiki/")) {
    const match = trimmed.match(/\/wiki\/([a-zA-Z0-9]+)/);
    const wikiToken = match ? match[1] : undefined;
    let tableId: string | undefined;
    let sheetId: string | undefined;
    try {
      const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      tableId = urlObj.searchParams.get("table") || undefined;
      sheetId = urlObj.searchParams.get("sheet") || undefined;
    } catch {
      // ignore
    }
    return { type: "wiki", wikiToken, tableId, sheetId };
  }
  if (trimmed.includes("/base/") || trimmed.includes("/bitable/")) {
    const match = trimmed.match(/\/(?:base|bitable)\/([a-zA-Z0-9]+)/);
    const appToken = match ? match[1] : undefined;
    let tableId: string | undefined;
    try {
      const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      tableId = urlObj.searchParams.get("table") || undefined;
    } catch {
      // ignore
    }
    return { type: "bitable", appToken, tableId };
  }
  if (trimmed.includes("/sheets/")) {
    const match = trimmed.match(/\/sheets\/([a-zA-Z0-9]+)/);
    const appToken = match ? match[1] : undefined;
    let sheetId: string | undefined;
    try {
      const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      sheetId = urlObj.searchParams.get("sheet") || undefined;
    } catch {
      // ignore
    }
    return { type: "sheet", appToken, sheetId };
  }
  if (trimmed.includes("/docx/") || trimmed.includes("/docs/")) {
    const match = trimmed.match(/\/(?:docx|docs)\/([a-zA-Z0-9]+)/);
    return { type: "docx", documentId: match ? match[1] : undefined };
  }
  return { type: "token", documentId: trimmed };
}

/**
 * 通用飞书数据源名单读取器
 */
export async function fetchRotationFromSource(sourceIdOrUrl: string): Promise<RotationMember[]> {
  const client = getLarkClient();
  if (!client) {
    throw new Error("请先在环境变量或 .env.local 中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET");
  }

  const parsed = parseFeishuUrl(sourceIdOrUrl);
  let rotation: SourceRotationMember[];

  // 1. 知识库（Wiki）
  if (parsed.type === "wiki" && parsed.wikiToken) {
    const nodeRes = await client.wiki.space.getNode({
      params: { token: parsed.wikiToken, obj_type: "wiki" },
    });
    if (nodeRes.code !== 0) {
      throw new Error(nodeRes.msg || "读取知识库节点失败，请确保应用已开通「wiki:wiki:readonly」权限并添加为协作者");
    }
    const appToken = nodeRes.data?.node?.obj_token;
    const objType = nodeRes.data?.node?.obj_type;

    if (objType === "bitable" && appToken) {
      rotation = await fetchBitableRecords(client, appToken, parsed.tableId);
    } else if (objType === "sheet" && appToken) {
      rotation = await fetchSheetRecords(client, appToken, parsed.sheetId);
    } else if (objType === "docx" && appToken) {
      rotation = await fetchDocxRecords(client, appToken);
    } else {
      throw new Error(`知识库节点类型 [${objType}] 暂不支持解析`);
    }
  } else if (parsed.type === "bitable" && parsed.appToken) {
    // 2. 多维表格（Bitable）
    rotation = await fetchBitableRecords(client, parsed.appToken, parsed.tableId);
  } else if (parsed.type === "sheet" && parsed.appToken) {
    // 3. 电子表格（Sheet）
    rotation = await fetchSheetRecords(client, parsed.appToken, parsed.sheetId);
  } else {
    // 4. 普通文档（Docx）
    const docId = parsed.documentId || sourceIdOrUrl;
    rotation = await fetchDocxRecords(client, docId);
  }

  return resolveRotationOpenIds(client, rotation);
}

async function fetchDocxRecords(client: lark.Client, documentId: string): Promise<SourceRotationMember[]> {
  const response = await client.docx.documentBlock.list({
    path: { document_id: documentId },
    params: { page_size: 500 },
  });
  if (response.code !== 0) throw new Error(response.msg || "读取飞书文档失败");
  const plainText = (response.data?.items ?? [])
    .map((block) => block.text?.elements?.map((element) => element.text_run?.content ?? "").join("") ?? "")
    .filter(Boolean)
    .join("\n");
  const rotation = plainText
    .split(/\r?\n/)
    .map(parseSourceRow)
    .filter((member): member is SourceRotationMember => Boolean(member));
  if (!rotation.length) throw new Error("未在文档中解析到名单，请确保第一列为姓名、第二列为邮箱");
  return rotation;
}

async function fetchBitableRecords(
  client: lark.Client,
  appToken: string,
  tableId?: string,
): Promise<SourceRotationMember[]> {
  let targetTableId = tableId;
  if (!targetTableId) {
    const tablesRes = await client.bitable.appTable.list({
      path: { app_token: appToken },
      params: { page_size: 20 },
    });
    if (tablesRes.code !== 0) {
      throw new Error(tablesRes.msg || "读取多维表格失败，请确认应用权限与协作者身份");
    }
    targetTableId = tablesRes.data?.items?.[0]?.table_id;
    if (!targetTableId) throw new Error("多维表格中未找到有效数据表");
  }

  const recordsRes = await client.bitable.appTableRecord.list({
    path: { app_token: appToken, table_id: targetTableId },
    params: { page_size: 500 },
  });
  if (recordsRes.code !== 0) throw new Error(recordsRes.msg || "读取多维表格记录失败");

  const items = recordsRes.data?.items ?? [];
  const rotation: SourceRotationMember[] = [];

  for (const item of items) {
    const fields = (item.fields || {}) as Record<string, unknown>;
    let nameVal: string | undefined;
    let emailVal: string | undefined;
    let mobileVal: string | undefined;
    let openIdVal: string | undefined;

    for (const [key, val] of Object.entries(fields)) {
      const keyText = key.toLowerCase();
      const strVal = textValue(val);
      const userValue = Array.isArray(val) && val[0] && typeof val[0] === "object" ? val[0] as Record<string, unknown> : undefined;
      const userId = typeof userValue?.id === "string" ? userValue.id : undefined;
      const userName = typeof userValue?.name === "string" ? userValue.name : undefined;

      if (userId?.startsWith("ou_")) openIdVal = userId;
      if (userName && !nameVal) nameVal = userName.trim();
      if (strVal.match(EMAIL_PATTERN) || /email|邮箱|邮件/.test(keyText)) {
        const emailMatch = strVal.match(EMAIL_PATTERN);
        if (emailMatch) emailVal = normalizeEmail(emailMatch[0]);
      }
      if (strVal.match(MOBILE_PATTERN) || /手机|手机号|mobile|电话/.test(keyText)) {
        const mobileMatch = strVal.match(MOBILE_PATTERN);
        if (mobileMatch) mobileVal = normalizeMobile(mobileMatch[0]);
      }
      if (!nameVal && /姓名|成员|主持人|轮值|名字|同学|人选/.test(keyText) && strVal) {
        nameVal = strVal;
      }
      if (!openIdVal && strVal.match(/^ou_[\w-]+$/)) openIdVal = strVal;
    }

    if (!nameVal) {
      const values = Object.values(fields).map(textValue).filter(Boolean);
      nameVal = values.find((value) => !EMAIL_PATTERN.test(value) && !/^ou_[\w-]+$/.test(value));
    }

    if (nameVal) {
      rotation.push({ name: nameVal, email: emailVal, mobile: mobileVal, openId: openIdVal });
    }
  }

  if (!rotation.length) throw new Error("多维表格中未解析到人员名单");
  return rotation;
}

async function fetchSheetRecords(
  client: lark.Client,
  spreadsheetToken: string,
  targetSheetId?: string,
): Promise<SourceRotationMember[]> {
  let sheetId = targetSheetId;

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
      }
    } catch {
      // ignore
    }
  }

  const range = sheetId ? `${sheetId}!A1:Z500` : "A1:Z500";
  const valuesRes = await client.request<{
    data?: { valueRange?: { values?: Array<Array<unknown>> } };
    code: number;
    msg: string;
  }>({
    url: `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
    method: "GET",
  });

  if (valuesRes.code !== 0) {
    throw new Error(valuesRes.msg || "读取电子表格数据失败，请确认应用权限与协作者身份");
  }

  const rows = valuesRes.data?.valueRange?.values ?? [];
  if (!rows || rows.length === 0) throw new Error("电子表格工作表内容为空");

  const rotation: SourceRotationMember[] = [];
  let nameColIdx = -1;
  let emailColIdx = -1;
  let mobileColIdx = -1;
  let openIdColIdx = -1;

  const headerRow = (rows[0] || []).map((cell) => String(cell ?? "").trim());
  headerRow.forEach((colName, idx) => {
    if (/姓名|成员|主持人|轮值|名字|同学|人选/i.test(colName)) nameColIdx = idx;
    if (/email|邮箱|邮件/i.test(colName)) emailColIdx = idx;
    if (/手机|手机号|mobile|电话/i.test(colName)) mobileColIdx = idx;
    if (/open_?id|飞书id|用户id|openid/i.test(colName)) openIdColIdx = idx;
  });

  const hasHeader = nameColIdx >= 0 || emailColIdx >= 0 || mobileColIdx >= 0 || openIdColIdx >= 0;
  if (!hasHeader) {
    nameColIdx = 0;
    emailColIdx = 1;
  }
  const startRowIdx = hasHeader ? 1 : 0;

  for (let i = startRowIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    let nameVal: string | undefined;
    let emailVal: string | undefined;
    let mobileVal: string | undefined;
    let openIdVal: string | undefined;

    if (nameColIdx >= 0 && row[nameColIdx]) {
      nameVal = textValue(row[nameColIdx]);
    }
    if (emailColIdx >= 0 && row[emailColIdx]) {
      const emailMatch = textValue(row[emailColIdx]).match(EMAIL_PATTERN);
      if (emailMatch) emailVal = normalizeEmail(emailMatch[0]);
    }
    if (mobileColIdx >= 0 && row[mobileColIdx]) {
      const mobileMatch = textValue(row[mobileColIdx]).match(MOBILE_PATTERN);
      if (mobileMatch) mobileVal = normalizeMobile(mobileMatch[0]);
    }
    if (openIdColIdx >= 0 && row[openIdColIdx]) {
      openIdVal = textValue(row[openIdColIdx]);
    }

    if (!nameVal || (!emailVal && !mobileVal)) {
      for (const cell of row) {
        const text = textValue(cell);
        if (!text) continue;
        const emailMatch = text.match(EMAIL_PATTERN);
        const mobileMatch = text.match(MOBILE_PATTERN);
        if (emailMatch && !emailVal) emailVal = normalizeEmail(emailMatch[0]);
        if (mobileMatch && !mobileVal) mobileVal = normalizeMobile(mobileMatch[0]);
        const parsed = parseSourceRow(text);
        if (parsed?.email && !emailVal) emailVal = parsed.email;
        if (parsed?.mobile && !mobileVal) mobileVal = parsed.mobile;
        if (parsed?.openId && !openIdVal) openIdVal = parsed.openId;
        if (parsed?.name && !nameVal && !EMAIL_PATTERN.test(text)) nameVal = parsed.name;
      }
    }

    if (nameVal) {
      rotation.push({ name: nameVal, email: emailVal, mobile: mobileVal, openId: openIdVal });
    }
  }

  if (!rotation.length) throw new Error("电子表格中未提取到人员名单，请确保第一列为姓名、第二列为邮箱");
  return rotation;
}
