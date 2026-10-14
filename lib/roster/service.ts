import fs from "fs";
import path from "path";
import {
  fetchRawMembersFromSource,
  getLarkClient,
  normalizeEmail,
  normalizeMobile,
  readUserCache,
  writeUserCache,
  sendWebhookMessage,
} from "@/lib/core/feishu-client";
import { getBot } from "@/lib/core/store";
import { RosterConfig, RosterMember } from "./types";
import {
  getRosterConfig,
  getRosterMembers,
  saveRosterConfig,
  saveRosterMembers,
  saveRosterStore,
} from "./store";

const DATA_DIR = path.join(process.cwd(), "data");
const USER_NAME_CACHE_FILE = path.join(DATA_DIR, "feishu-user-name-cache.json");

function readUserNameCache(): Record<string, string> {
  try {
    if (fs.existsSync(USER_NAME_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USER_NAME_CACHE_FILE, "utf-8"));
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

function writeUserNameCache(cache: Record<string, string>) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempFile = `${USER_NAME_CACHE_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf-8");
    fs.renameSync(tempFile, USER_NAME_CACHE_FILE);
  } catch (error) {
    console.error("保存 feishu-user-name-cache.json 失败:", error);
  }
}

/**
 * 从飞书远程数据源（Wiki/Sheet/Bitable/Docx）同步最新成员名单
 */
export async function syncRoster(
  sourceUrlOverride?: string,
): Promise<{ success: boolean; count: number; members: RosterMember[]; error?: string }> {
  const config = getRosterConfig();
  const sourceUrl = (sourceUrlOverride || config.sourceUrl || "").trim();

  if (!sourceUrl) {
    throw new Error("请先配置飞书数据源链接");
  }

  try {
    const rawMembers = await fetchRawMembersFromSource(sourceUrl);
    if (!rawMembers || rawMembers.length === 0) {
      throw new Error("未能从该飞书数据源中解析到任何成员");
    }

    const client = getLarkClient();
    const userCache = readUserCache();
    const userNameCache = readUserNameCache();

    // 寻找需要查询 Open ID 的邮箱和手机号
    if (client) {
      const identitiesToQuery = rawMembers
        .filter((member) => !member.openId && (member.email || member.mobile))
        .map((member) => ({
          email: member.email ? normalizeEmail(member.email) : undefined,
          mobile: member.mobile ? normalizeMobile(member.mobile) : undefined,
        }))
        .filter(({ email, mobile }) => !userCache[email || ""] && !userCache[mobile || ""]);

      for (let index = 0; index < identitiesToQuery.length; index += 50) {
        const batch = identitiesToQuery.slice(index, index + 50);
        try {
          const response = await client.contact.user.batchGetId({
            params: { user_id_type: "open_id" },
            data: {
              emails: batch.flatMap(({ email }) => (email ? [email] : [])),
              mobiles: batch.flatMap(({ mobile }) => (mobile ? [mobile] : [])),
            },
          });
          if (response.code === 0 && response.data?.user_list) {
            for (const user of response.data.user_list) {
              if (user.email && user.user_id) userCache[normalizeEmail(user.email)] = user.user_id;
              if (user.mobile && user.user_id) userCache[normalizeMobile(user.mobile)] = user.user_id;
            }
          }
        } catch (queryErr) {
          console.warn("飞书用户 ID 批量查询出现异常（跳过部分未授权查询）:", queryErr);
        }
      }

      if (identitiesToQuery.length > 0) {
        writeUserCache(userCache);
      }
    }

    const now = new Date().toISOString();
    const updatedMembers: RosterMember[] = rawMembers.map((member) => {
      const name = member.name.trim();
      const email = member.email ? normalizeEmail(member.email) : "";
      const mobile = member.mobile ? normalizeMobile(member.mobile) : undefined;
      const openId =
        member.openId ||
        (email ? userCache[email] : undefined) ||
        (mobile ? userCache[mobile] : undefined);

      if (openId && name) {
        userNameCache[openId] = name;
      }

      const atTag = openId ? `<at id="${openId}">${name}</at>` : `@${name}`;
      const id = openId || (email ? email.split("@")[0] : `member_${name}`);

      return {
        id,
        name,
        email,
        mobile,
        openId,
        atTag,
        updatedAt: now,
      };
    });

    writeUserNameCache(userNameCache);

    const resolvedOpenIdCount = updatedMembers.filter((m) => Boolean(m.openId)).length;
    const nextConfig: RosterConfig = {
      ...config,
      sourceUrl,
      lastSyncAt: now,
      lastSyncStatus: "success",
      lastSyncError: undefined,
      totalMembers: updatedMembers.length,
      resolvedOpenIdCount,
    };

    saveRosterStore({
      config: nextConfig,
      members: updatedMembers,
    });

    return {
      success: true,
      count: updatedMembers.length,
      members: updatedMembers,
    };
  } catch (error: any) {
    const errorMsg = error?.message || "同步飞书名单失败";
    saveRosterConfig({
      sourceUrl,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "error",
      lastSyncError: errorMsg,
    });
    throw error;
  }
}

/**
 * 通用查询函数：通过姓名查询成员信息
 * 优先精确匹配，再容错前缀/后缀/括号（如 "刘哲同学"、"刘哲(前端)" 均可识别出 "刘哲"）
 */
export function findMemberByName(name: string): RosterMember | undefined {
  if (!name) return undefined;
  const clean = name.trim();
  if (!clean) return undefined;

  const members = getRosterMembers();

  // 1. 精确匹配
  const exact = members.find((m) => m.name === clean);
  if (exact) return exact;

  // 2. 忽略大小写匹配（英文名场景）
  const lower = clean.toLowerCase();
  const caseMatch = members.find((m) => m.name.toLowerCase() === lower);
  if (caseMatch) return caseMatch;

  // 3. 容错匹配：如果输入的名字包含成员名字（如 "刘哲同学" 或 "@刘哲"）
  const subMatch = members.find((m) => clean.includes(m.name) && m.name.length >= 2);
  if (subMatch) return subMatch;

  // 4. 容错匹配：如果成员名字包含输入名字（如输入 "刘云" 匹配 "刘云01" 等）
  const reverseSub = members.find((m) => m.name.includes(clean) && clean.length >= 2);
  if (reverseSub) return reverseSub;

  // 5. 尝试匹配邮箱前缀（如输入 "zhe.liu01" 找到 "刘哲"）
  const emailPrefixMatch = members.find((m) => {
    if (!m.email) return false;
    const prefix = m.email.split("@")[0].toLowerCase();
    return prefix === lower;
  });
  if (emailPrefixMatch) return emailPrefixMatch;

  return undefined;
}

/**
 * 通用查询函数：通过邮箱查询成员信息
 */
export function findMemberByEmail(email: string): RosterMember | undefined {
  if (!email) return undefined;
  const target = normalizeEmail(email);
  const members = getRosterMembers();
  return members.find((m) => normalizeEmail(m.email) === target);
}

/**
 * 通用查询函数：通过飞书 openId 查询成员信息
 */
export function findMemberByOpenId(openId: string): RosterMember | undefined {
  if (!openId) return undefined;
  const target = openId.trim();
  const members = getRosterMembers();
  return members.find((m) => m.openId === target);
}

/**
 * 【通用核心快捷功能】通过姓名直接获取邮箱
 */
export function getEmailByName(name: string): string | undefined {
  const member = findMemberByName(name);
  return member?.email || undefined;
}

/**
 * 【通用核心快捷功能】通过姓名直接获取飞书 @ 语法字符串
 * 例如：`<at id="ou_xxx">刘哲</at>`
 */
export function getAtTagByName(name: string): string {
  const member = findMemberByName(name);
  if (member?.atTag) return member.atTag;
  if (member?.openId) return `<at id="${member.openId}">${member.name}</at>`;
  return `@${name.trim()}`;
}

/**
 * 【通用核心快捷功能】通过姓名直接获取飞书 Open ID
 */
export function getOpenIdByName(name: string): string | undefined {
  const member = findMemberByName(name);
  return member?.openId || undefined;
}

/**
 * 【通用飞书富文本元素】构造适用于飞书消息 post / card 格式的 at 对象
 */
export function getAtElementByName(name: string): { tag: "at"; user_id?: string; user_name: string } {
  const member = findMemberByName(name);
  return {
    tag: "at",
    user_id: member?.openId,
    user_name: member?.name || name,
  };
}

/**
 * 文本自动 @ 转换器：将任意文本中的 `@姓名` 自动替换为飞书 `<at id="ou_xxx">姓名</at>` 标签
 */
export function replaceNamesWithAtTags(text: string): string {
  if (!text) return "";
  const members = getRosterMembers();
  let result = text;
  for (const member of members) {
    if (!member.openId || !member.name) continue;
    // 匹配 @姓名 或者 @ 姓名
    const pattern = new RegExp(`@\\s*${member.name}\\b`, "g");
    result = result.replace(pattern, `<at id="${member.openId}">${member.name}</at>`);
  }
  return result;
}

/**
 * 关键词综合检索（支持检索姓名、邮箱、Open ID、手机号）
 */
export function searchMembers(query: string, limit: number = 20): RosterMember[] {
  const members = getRosterMembers();
  const q = (query || "").trim().toLowerCase();
  if (!q) return members.slice(0, limit);

  return members
    .filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.openId && m.openId.toLowerCase().includes(q)) ||
        (m.mobile && m.mobile.includes(q)),
    )
    .slice(0, limit);
}

/**
 * 发送一条测试 @ 消息到指定的飞书群机器人，以验证 @ 功能生效
 */
export async function sendTestAtNotification(
  botId: string,
  memberName: string,
  customMessage?: string,
): Promise<{ ok: boolean; message: string }> {
  const bot = getBot(botId);
  if (!bot || !bot.webhookUrl) {
    throw new Error(`找不到机器人或机器人未配置 Webhook URL (botId: ${botId})`);
  }

  const member = findMemberByName(memberName);
  const atSnippet = member?.openId
    ? `<at id="${member.openId}">${member.name}</at>`
    : `@${memberName}`;

  const messageText =
    customMessage?.trim() ||
    `这是一条飞书名单通用 @ 能力连通性测试消息：\n问候 ${atSnippet} 同学，您已成功关联飞书名单（邮箱：${member?.email || "未填写"}，Open ID：${member?.openId || "未解析"}）。`;

  const payload = {
    msg_type: "interactive" as const,
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: "🔔 飞书名单 @ 能力连通性测试",
        },
        template: "blue",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: messageText,
          },
        },
        {
          tag: "hr",
        },
        {
          tag: "note",
          elements: [
            {
              tag: "plain_text",
              content: `发送时间: ${new Date().toLocaleString("zh-CN")} · 来自 Orbit 系统设置`,
            },
          ],
        },
      ],
    },
  };

  await sendWebhookMessage(bot.webhookUrl, payload);
  return { ok: true, message: `测试消息已成功发送至机器人「${bot.name}」` };
}
