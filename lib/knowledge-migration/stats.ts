import "server-only";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { getFeishuClient, parseDocumentTarget, formatLarkError } from "@/lib/mcp/feishu-doc-engine";
import { addTaskAuditLog, getTask, saveTaskMigrationStats, persistMigrationState } from "./store";
import type {
  FeishuFullDocItem,
  KnowledgeMigrationTask,
  MigrationDocOrigin,
  MigrationPersonStat,
  MigrationWeeklyStat,
  TaskMigrationStats,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const USER_NAME_CACHE_FILE = path.join(DATA_DIR, "feishu-user-name-cache.json");

type UserNameCache = Record<string, string>;

function readUserNameCache(): UserNameCache {
  try {
    if (fs.existsSync(USER_NAME_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USER_NAME_CACHE_FILE, "utf-8")) as UserNameCache;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

function writeUserNameCache(cache: UserNameCache) {
  try {
    fs.mkdirSync(path.dirname(USER_NAME_CACHE_FILE), { recursive: true });
    const tempFile = `${USER_NAME_CACHE_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf-8");
    fs.renameSync(tempFile, USER_NAME_CACHE_FILE);
  } catch {
    // ignore
  }
}

interface RawFeishuNode {
  node_token: string;
  obj_token?: string;
  obj_type?: string;
  title: string;
  parent_node_token?: string;
  node_create_time?: string;
  obj_create_time?: string;
  creator?: string;
  owner?: string;
  has_child?: boolean;
}
 
/**
 * 高性能 BFS 分层批次并发扫描飞书知识库全量节点
 */
async function listAllFeishuNodes(spaceId: string, rootWikiToken: string): Promise<RawFeishuNode[]> {
  const client = getFeishuClient();
  const allNodes: RawFeishuNode[] = [];
  const visitedTokens = new Set<string>();
  const limit = pLimit(12);

  async function fetchChildrenOf(parentToken?: string): Promise<RawFeishuNode[]> {
    const items: RawFeishuNode[] = [];
    let pageToken: string | undefined;
    do {
      let response;
      try {
        response = await client.wiki.spaceNode.list({
          path: { space_id: spaceId },
          params: {
            ...(parentToken ? { parent_node_token: parentToken } : {}),
            page_size: 50,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
      } catch (error) {
        console.warn(`拉取节点 [${parentToken || "root"}] 子节点失败:`, error);
        break;
      }

      if (response.code !== 0) {
        console.warn(`拉取节点 [${parentToken || "root"}] 返回错误:`, response.msg);
        break;
      }

      const list = (response.data?.items ?? []) as RawFeishuNode[];
      for (const node of list) {
        if (node.node_token && !visitedTokens.has(node.node_token)) {
          visitedTokens.add(node.node_token);
          items.push(node);
        }
      }
      pageToken = response.data?.has_more ? response.data.page_token : undefined;
    } while (pageToken);
    return items;
  }

  const startTime = Date.now();

  // 1. 获取第一层节点
  let currentLayer = await fetchChildrenOf(rootWikiToken);
  if (!currentLayer.length) {
    const rootNodes = await fetchChildrenOf(undefined);
    currentLayer = rootNodes.filter((n) => n.node_token !== rootWikiToken);
  }

  allNodes.push(...currentLayer);
  let layerNum = 1;

  // 2. BFS 分层批次并发推进
  while (currentLayer.length > 0) {
    const nodesWithChild = currentLayer.filter((n) => n.has_child);
    if (nodesWithChild.length === 0) break;

    const nextLayerChildren = await Promise.all(
      nodesWithChild.map((node) => limit(() => fetchChildrenOf(node.node_token)))
    );

    currentLayer = nextLayerChildren.flat();
    allNodes.push(...currentLayer);
    layerNum++;
  }

  console.log(`[飞书知识库扫描] 完成！共扫描 ${layerNum} 层、${allNodes.length} 个文档节点，耗时 ${Date.now() - startTime}ms`);
  return allNodes;
}

export function isBotOrSystemAccount(name: string, userId?: string): boolean {
  if (name === "Wiki 归档系统") return true;
  if (userId === "ou_8a0d18f26e02a0a5add005b36c2d8eb8") return true;
  if (name.includes("8eb8") || name.includes("机器人") || name.toLowerCase().includes("bot")) return true;
  return false;
}

/**
 * 解析飞书创建人 ID 为真实用户姓名（带本地缓存与降级）
 */
async function resolveUserNames(userIds: string[]): Promise<Record<string, string>> {
  const cache = readUserNameCache();

  // 预置系统已知成员映射与机器人标注
  if (!cache["ou_9dae6d2b1b9fdaa4e2980fe7bbb655a7"]) {
    cache["ou_9dae6d2b1b9fdaa4e2980fe7bbb655a7"] = "刘哲";
  }
  if (!cache["ou_8a0d18f26e02a0a5add005b36c2d8eb8"]) {
    cache["ou_8a0d18f26e02a0a5add005b36c2d8eb8"] = "迁移机器人";
  }

  const client = getFeishuClient();
  const missingIds = Array.from(new Set(userIds)).filter((id) => id && !cache[id]);

  if (missingIds.length > 0) {
    const limit = pLimit(8);
    let updated = false;

    await Promise.all(
      missingIds.map((id) =>
        limit(async () => {
          try {
            const res = await client.contact.user.get({
              path: { user_id: id },
              params: { user_id_type: "open_id" },
            });
            if (res.code === 0 && res.data?.user?.name) {
              cache[id] = res.data.user.name;
              updated = true;
              return;
            }
          } catch {
            // 通讯录无权限时静默降级，避免阻塞扫描
          }

          cache[id] = `飞书成员_${id.slice(-4)}`;
          updated = true;
        })
      )
    );

    if (updated) {
      writeUserNameCache(cache);
    }
  }

  return cache;
}

function parseCreateTimestamp(node: RawFeishuNode): Date {
  const raw = node.node_create_time || node.obj_create_time;
  if (!raw) return new Date();
  const num = Number(raw);
  if (!Number.isNaN(num) && num > 0) {
    // 判断是秒级还是毫秒级时间戳
    return new Date(num > 1e11 ? num : num * 1000);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getISOWeekInfo(date: Date): { weekKey: string; weekLabel: string; startDate: string; endDate: string; sortKey: number } {
  // 计算当周周一
  const mon = new Date(date);
  const currentDay = mon.getDay() || 7; // 1: Mon ... 7: Sun
  mon.setDate(mon.getDate() - currentDay + 1);
  mon.setHours(0, 0, 0, 0);

  // 计算当周周日
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  // 计算 ISO 周数 (基于当周周四)
  const thu = new Date(mon);
  thu.setDate(thu.getDate() + 3);
  const year = thu.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const days = Math.floor((thu.getTime() - firstJan.getTime()) / 86400000);
  const weekNo = Math.ceil((days + firstJan.getDay() + 1) / 7);

  const pad = (n: number) => String(n).padStart(2, "0");
  const formatDate = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const formatShort = (dt: Date) => `${pad(dt.getMonth() + 1)}/${pad(dt.getDate())}`;

  const weekKey = `${year}-W${pad(weekNo)}`;
  const weekLabel = `${year}年第${weekNo}周 (${formatShort(mon)} - ${formatShort(sun)})`;
  const startDate = formatDate(mon);
  const endDate = formatDate(sun);
  const sortKey = mon.getTime();

  return { weekKey, weekLabel, startDate, endDate, sortKey };
}

/**
 * 核心逻辑：扫描目标飞书知识库全量文档并生成周度对比分析统计
 */
export async function generateMigrationWeeklyStats(taskId: string): Promise<TaskMigrationStats> {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  if (!task.config.targetWikiRoot) throw new Error("任务缺少目标飞书知识库根节点配置");

  const parsed = parseDocumentTarget(task.config.targetWikiRoot);
  if (!parsed.wikiToken) throw new Error("目标飞书知识库 URL 或 token 无效");

  const client = getFeishuClient();
  let rootResult;
  try {
    rootResult = await client.wiki.space.getNode({ params: { token: parsed.wikiToken, obj_type: "wiki" } });
  } catch (error) {
    throw new Error(formatLarkError(error, "读取飞书知识库空间信息失败"));
  }
  const spaceId = rootResult.data?.node?.space_id;
  if (!spaceId) throw new Error("未能获取飞书知识库 space_id");

  let origin = "https://open.feishu.cn";
  try {
    origin = new URL(task.config.targetWikiRoot.startsWith("http") ? task.config.targetWikiRoot : `https://${task.config.targetWikiRoot}`).origin;
  } catch {
    // ignore
  }

  // 1. 全量扫描飞书知识库节点
  const rawNodes = await listAllFeishuNodes(spaceId, parsed.wikiToken);

  // 2. 收集所有创建人 ID 并批量解析姓名
  const allUserIds = rawNodes.map((n) => n.creator || n.owner || "").filter(Boolean);
  const userNameMap = await resolveUserNames(allUserIds);

  // 3. 构建本地 Wiki 归档文档映射索引与目标知识库目录映射
  const wikiItemByToken = new Map<string, (typeof task.items)[string]>();
  for (const item of Object.values(task.items || {})) {
    if (item.status === "migrated") {
      if (item.targetNodeToken) wikiItemByToken.set(item.targetNodeToken, item);
      if (item.targetDocumentToken) wikiItemByToken.set(item.targetDocumentToken, item);
    }
  }

  // 构建目标目录映射表（用于非 Wiki 文档反查所属分类）
  const categoryByNodeToken = new Map<string, { primary: string; secondary?: string }>();
  for (const dir of task.targetDirectories || []) {
    categoryByNodeToken.set(dir.nodeToken, { primary: dir.title });
    for (const child of dir.children || []) {
      categoryByNodeToken.set(child.nodeToken, { primary: dir.title, secondary: child.title });
    }
  }

  const parentTokenMap = new Map<string, string>();
  for (const node of rawNodes) {
    if (node.parent_node_token) {
      parentTokenMap.set(node.node_token, node.parent_node_token);
    }
  }

  function resolveDocCategory(node: RawFeishuNode): { primary: string; secondary?: string } {
    let curr = node.parent_node_token;
    let guard = 0;
    while (curr && guard < 15) {
      guard++;
      const cat = categoryByNodeToken.get(curr);
      if (cat) return cat;
      curr = parentTokenMap.get(curr);
    }
    return { primary: "未归类/空间根目录" };
  }

  // 4. 将每个飞书节点标记为 Wiki 迁移文档或外部非 Wiki 文档
  const docItems: FeishuFullDocItem[] = [];

  for (const node of rawNodes) {
    const matchedWiki =
      wikiItemByToken.get(node.node_token) ||
      (node.obj_token ? wikiItemByToken.get(node.obj_token) : undefined);

    const isWiki = Boolean(matchedWiki);
    const originType: MigrationDocOrigin = isWiki ? "wiki_migration" : "external_feishu";

    // 确定时间
    let docDate = parseCreateTimestamp(node);
    if (matchedWiki?.migratedAt) {
      const mDate = new Date(matchedWiki.migratedAt);
      if (!Number.isNaN(mDate.getTime())) {
        docDate = mDate;
      }
    }

    // 确定创建人/迁移人姓名
    let personName = "未知成员";
    const creatorId = node.creator || node.owner;

    if (isWiki) {
      personName =
        matchedWiki?.approvedBy?.trim() ||
        task.config.defaultOperatorName?.trim() ||
        "Wiki 归档系统";
    } else {
      personName = (creatorId ? userNameMap[creatorId] : undefined) || "飞书成员";
    }

    // 确定分类：Wiki 优先使用归档分类，非 Wiki 通过目录拓扑推断
    let docPrimaryCategory = matchedWiki?.finalPrimaryCategory;
    let docSecondaryCategory = matchedWiki?.finalSecondaryCategory;
    if (!isWiki) {
      const resolved = resolveDocCategory(node);
      docPrimaryCategory = resolved.primary;
      docSecondaryCategory = resolved.secondary;
    }

    docItems.push({
      nodeToken: node.node_token,
      documentToken: node.obj_token || node.node_token,
      title: node.title || (matchedWiki?.finalTitle ?? "未命名文档"),
      url: `${origin}/wiki/${node.node_token}`,
      createTime: docDate.toISOString(),
      creatorId,
      creatorName: personName,
      origin: originType,
      wikiId: matchedWiki?.wikiId,
      primaryCategory: docPrimaryCategory,
      secondaryCategory: docSecondaryCategory,
      parentNodeToken: node.parent_node_token,
    });
  }

  // 5. 按自然周聚合
  interface WeekBucket {
    weekKey: string;
    weekLabel: string;
    startDate: string;
    endDate: string;
    sortKey: number;
    items: FeishuFullDocItem[];
  }

  const weekMap = new Map<string, WeekBucket>();

  for (const doc of docItems) {
    const docDate = new Date(doc.createTime);
    const { weekKey, weekLabel, startDate, endDate, sortKey } = getISOWeekInfo(docDate);

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        weekKey,
        weekLabel,
        startDate,
        endDate,
        sortKey,
        items: [],
      });
    }
    weekMap.get(weekKey)!.items.push(doc);
  }

  // 6. 构造周度汇总数据
  const sortedWeeks = Array.from(weekMap.values()).sort((a, b) => b.sortKey - a.sortKey);

  const weeklyStats: MigrationWeeklyStat[] = sortedWeeks.map((bucket) => {
    let nonWikiCount = 0;
    let wikiCount = 0;
    const personMap = new Map<string, { nonWiki: number; wiki: number; userId?: string; catMap: Map<string, number> }>();

    for (const item of bucket.items) {
      if (item.origin === "wiki_migration") {
        wikiCount++;
      } else {
        nonWikiCount++;
      }

      const pName = item.creatorName;
      if (!personMap.has(pName)) {
        personMap.set(pName, { nonWiki: 0, wiki: 0, userId: item.creatorId, catMap: new Map() });
      }
      const pStat = personMap.get(pName)!;
      if (item.origin === "wiki_migration") {
        pStat.wiki++;
      } else {
        pStat.nonWiki++;
        const catName = item.primaryCategory || "未归类";
        pStat.catMap.set(catName, (pStat.catMap.get(catName) || 0) + 1);
      }
    }

    const persons: MigrationPersonStat[] = Array.from(personMap.entries())
      .filter(([personName, stat]) => !isBotOrSystemAccount(personName, stat.userId))
      .map(([personName, stat]) => ({
        personName,
        userId: stat.userId,
        nonWikiCount: stat.nonWiki,
        wikiCount: stat.wiki,
        totalCount: stat.nonWiki + stat.wiki,
        categories: Array.from(stat.catMap.entries())
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.nonWikiCount - a.nonWikiCount || b.totalCount - a.totalCount);

    return {
      weekKey: bucket.weekKey,
      weekLabel: bucket.weekLabel,
      startDate: bucket.startDate,
      endDate: bucket.endDate,
      totalCount: bucket.items.length,
      nonWikiCount,
      wikiCount,
      persons,
      items: bucket.items.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()),
    };
  });

  // 7. 全局人员排行榜与全量分类累计统计
  const globalPersonMap = new Map<string, { nonWiki: number; wiki: number; userId?: string; catMap: Map<string, number> }>();
  const globalCategoryMap = new Map<string, number>();

  for (const doc of docItems) {
    const pName = doc.creatorName;
    if (!globalPersonMap.has(pName)) {
      globalPersonMap.set(pName, { nonWiki: 0, wiki: 0, userId: doc.creatorId, catMap: new Map() });
    }
    const stat = globalPersonMap.get(pName)!;
    if (doc.origin === "wiki_migration") {
      stat.wiki++;
    } else {
      stat.nonWiki++;
      const catName = doc.primaryCategory || "未归类";
      stat.catMap.set(catName, (stat.catMap.get(catName) || 0) + 1);
      globalCategoryMap.set(catName, (globalCategoryMap.get(catName) || 0) + 1);
    }
  }

  const personsRank: MigrationPersonStat[] = Array.from(globalPersonMap.entries())
    .filter(([personName, stat]) => !isBotOrSystemAccount(personName, stat.userId))
    .map(([personName, stat]) => ({
      personName,
      userId: stat.userId,
      nonWikiCount: stat.nonWiki,
      wikiCount: stat.wiki,
      totalCount: stat.nonWiki + stat.wiki,
      categories: Array.from(stat.catMap.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.nonWikiCount - a.nonWikiCount || b.totalCount - a.totalCount);

  const categoryRank = Array.from(globalCategoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const totalNonWikiDocs = docItems.filter((d) => d.origin === "external_feishu").length;
  const totalWikiDocs = docItems.filter((d) => d.origin === "wiki_migration").length;

  const statsResult: TaskMigrationStats = {
    taskId,
    totalFeishuDocs: docItems.length,
    totalNonWikiDocs,
    totalWikiDocs,
    totalPersons: personsRank.length,
    personsRank,
    categoryRank,
    weeks: weeklyStats,
    updatedAt: new Date().toISOString(),
  };

  // 持久化保存
  saveTaskMigrationStats(taskId, statsResult);
  addTaskAuditLog(taskId, {
    action: "stats_generated" as any,
    detail: `已完成飞书知识库全量文档分析：共 ${docItems.length} 篇（非 Wiki 新增 ${totalNonWikiDocs} 篇，Wiki 归档 ${totalWikiDocs} 篇），涵盖 ${weeklyStats.length} 个自然周`,
  });
  persistMigrationState();

  return statsResult;
}
