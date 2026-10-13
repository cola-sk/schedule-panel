import "server-only";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { getFeishuClient, parseDocumentTarget, formatLarkError } from "@/lib/mcp/feishu-doc-engine";
import { addTaskAuditLog, getTask, saveTaskMigrationStats, persistMigrationState } from "./store";
import { atShanghaiLocal, chinaDateKey, chinaWeekday } from "@/lib/core/scheduler";
import type {
  CycleStatsResult,
  FeishuFullDocItem,
  KnowledgeDirectory,
  KnowledgeMigrationTask,
  MigrationDocOrigin,
  MigrationPersonStat,
  MigrationWeeklyStat,
  StatCycleType,
  TaskMigrationStats,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const USER_NAME_CACHE_FILE = path.join(DATA_DIR, "feishu-user-name-cache.json");
const LEDGER_FILE = path.join(DATA_DIR, "knowledge-node-ingestion-ledger.json");

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

export interface NodeIngestionRecord {
  nodeToken: string;
  documentToken?: string;
  title?: string;
  ingestedAt: string; // ISO 格式入库时间
  originalCreateTime?: string; // 原始草拟创建时间
  operatorId?: string; // 贡献/迁移操作人 open_id
  operatorName?: string; // 贡献/迁移操作人姓名
  source?: "wiki_migration" | "feishu_node" | "first_seen";
}

type IngestionLedger = Record<string, NodeIngestionRecord>;

export function readIngestionLedger(): IngestionLedger {
  try {
    if (fs.existsSync(LEDGER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf-8")) as IngestionLedger;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

export function writeIngestionLedger(ledger: IngestionLedger) {
  try {
    fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
    const tempFile = `${LEDGER_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(ledger, null, 2), "utf-8");
    fs.renameSync(tempFile, LEDGER_FILE);
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
  node_creator?: string;
  has_child?: boolean;
}
 
/**
 * 高性能 BFS 分层批次并发扫描飞书知识库全量节点
 */
async function listAllFeishuNodes(
  spaceId: string,
  rootWikiToken: string,
  knownDirectoryTokens?: Set<string>,
): Promise<RawFeishuNode[]> {
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

  // 2. BFS 分层批次并发推进（针对已知分类目录及飞书返回 has_child 的目录均展开拉取，避免漏扫）
  while (currentLayer.length > 0) {
    const nodesWithChild = currentLayer.filter(
      (n) => Boolean(n.has_child || (knownDirectoryTokens && knownDirectoryTokens.has(n.node_token)))
    );
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
  if (name.includes("8eb8") || name.includes("机器人") || name.toLowerCase().includes("bot")) return true;
  // 只有当名字未明确或带有系统成员特征，且 userId 属于迁移机器人时才判定为机器人
  if (userId === "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
    if (!name || name === "飞书成员" || name === "未知成员" || name === "迁移机器人") return true;
  }
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

function parseRawTimestamp(raw?: string | number): Date | null {
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isNaN(num) && num > 0) {
    // 判断是秒级还是毫秒级时间戳
    return new Date(num > 1e11 ? num : num * 1000);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCreateTimestamp(node: RawFeishuNode): Date {
  return parseRawTimestamp(node.node_create_time || node.obj_create_time) || new Date();
}

function getISOWeekInfo(
  date: Date,
  now = new Date(),
): {
  weekKey: string;
  weekLabel: string;
  startDate: string;
  endDate: string;
  sortKey: number;
  isCurrentWeek: boolean;
} {
  // 基于北京时间 (Asia/Shanghai) 计算自然周 (周一 00:00 至 周日 23:59:59)
  const dShanghai = atShanghaiLocal(date, "00:00");
  const weekday = chinaWeekday(date); // 1: Mon ... 7: Sun
  const mon = new Date(dShanghai.getTime() - (weekday - 1) * 86400000);
  mon.setHours(0, 0, 0, 0);

  const sun = new Date(mon.getTime() + 6 * 86400000);
  sun.setHours(23, 59, 59, 999);

  // 计算 ISO 周数 (基于当周周四)
  const thu = new Date(mon.getTime() + 3 * 86400000);
  const year = thu.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const days = Math.floor((thu.getTime() - firstJan.getTime()) / 86400000);
  const weekNo = Math.ceil((days + firstJan.getDay() + 1) / 7);

  const pad = (n: number) => String(n).padStart(2, "0");
  const monKey = chinaDateKey(mon);
  const sunKey = chinaDateKey(sun);
  const formatShort = (key: string) => key.slice(5).replace("-", "/");

  const weekKey = `${year}-W${pad(weekNo)}`;
  const weekLabel = `${year}年第${weekNo}周 (${formatShort(monKey)} - ${formatShort(sunKey)})`;
  const startDate = monKey;
  const endDate = sunKey;
  const sortKey = mon.getTime();

  // 判断是否为当前北京时间所在周
  const nowWeekday = chinaWeekday(now);
  const nowMonday = new Date(atShanghaiLocal(now, "00:00").getTime() - (nowWeekday - 1) * 86400000);
  const isCurrentWeek = mon.getTime() === nowMonday.getTime();

  return { weekKey, weekLabel, startDate, endDate, sortKey, isCurrentWeek };
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

  // 1. 构建已知目标目录集合（防飞书 API has_child: false 漏扫）
  const knownDirectoryTokens = new Set<string>();
  for (const dir of task.targetDirectories || []) {
    if (dir.nodeToken) knownDirectoryTokens.add(dir.nodeToken);
    for (const child of dir.children || []) {
      if (child.nodeToken) knownDirectoryTokens.add(child.nodeToken);
    }
  }

  // 读取本地持久化入库账本（锁定历史真实入库时间）
  const ledger = readIngestionLedger();

  // 全量扫描飞书知识库节点
  const rawNodes = await listAllFeishuNodes(spaceId, parsed.wikiToken, knownDirectoryTokens);

  // 构建全量原始节点索引表（用于拓扑父节点时间对比与因果校验）
  const rawNodeMap = new Map<string, RawFeishuNode>();
  for (const node of rawNodes) {
    rawNodeMap.set(node.node_token, node);
  }

  // 2. 收集所有创建人 / 节点操作人 ID 并批量解析姓名
  const allUserIds = rawNodes
    .map((n) => n.node_creator || n.creator || n.owner || "")
    .filter(Boolean);
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

  function resolveDocCategory(node: { parent_node_token?: string }): { primary: string; secondary?: string } {
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

  // 4. 将每个飞书节点标记为 Wiki 迁移文档或外部非 Wiki 文档，并基于“实际入库时间”精确归集
  const docItems: FeishuFullDocItem[] = [];
  const scanTime = new Date();

  for (const node of rawNodes) {
    const matchedWiki =
      wikiItemByToken.get(node.node_token) ||
      (node.obj_token ? wikiItemByToken.get(node.obj_token) : undefined);

    const isWiki = Boolean(matchedWiki);
    const originType: MigrationDocOrigin = isWiki ? "wiki_migration" : "external_feishu";

    // 原始底层创建时间 (保留作为参考)
    const rawOriginalDt = parseRawTimestamp(node.obj_create_time || node.node_create_time);
    const originalCreateTime = rawOriginalDt ? rawOriginalDt.toISOString() : undefined;

    // 实际迁移/入库时间判定 (Ingestion Time)：
    // 优先级 1: Wiki 归档系统完成时间 matchedWiki.migratedAt
    // 优先级 2: 本地持久化账本记录时间 ledger[token].ingestedAt (基线稳定，锁定不漂移)
    // 优先级 3: 知识库新出现的节点 (首次扫描发现): 无论其底层文件何时在个人网盘草拟，其实际进入知识库的贡献时间，确立为首次被扫描发现的当前入库时间 (当周)
    let docDate: Date;
    let ingestionSource: NodeIngestionRecord["source"] = "feishu_node";

    if (matchedWiki?.migratedAt) {
      const parsedDt = new Date(matchedWiki.migratedAt);
      docDate = !Number.isNaN(parsedDt.getTime()) ? parsedDt : new Date();
      ingestionSource = "wiki_migration";
    } else if (ledger[node.node_token]?.ingestedAt) {
      const parsedDt = new Date(ledger[node.node_token].ingestedAt);
      docDate = !Number.isNaN(parsedDt.getTime()) ? parsedDt : new Date();
      ingestionSource = ledger[node.node_token].source || "feishu_node";
    } else if (node.obj_token && ledger[node.obj_token]?.ingestedAt) {
      const parsedDt = new Date(ledger[node.obj_token].ingestedAt);
      docDate = !Number.isNaN(parsedDt.getTime()) ? parsedDt : new Date();
      ingestionSource = ledger[node.obj_token].source || "feishu_node";
    } else {
      docDate = scanTime;
      ingestionSource = "first_seen";
    }

    // 确定迁移/创建人员姓名
    let personName = "未知成员";
    let creatorId = node.node_creator || node.creator || node.owner;

    if (isWiki) {
      personName =
        matchedWiki?.approvedBy?.trim() ||
        task.config.defaultOperatorName?.trim() ||
        "Wiki 归档系统";
      if (personName !== "Wiki 归档系统" && creatorId === "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
        const matchedUserId = Object.entries(userNameMap).find(([, name]) => name === personName)?.[0];
        creatorId = matchedUserId || undefined;
      }
    } else if (ledger[node.node_token]?.operatorName) {
      personName = ledger[node.node_token].operatorName!;
      creatorId = ledger[node.node_token].operatorId || creatorId;
    } else {
      // 外部移入文档：若 node_creator 为 OpenAPI 机器人（通过系统或 API 移入），操作人归属于文档拥有者
      let targetUserId = node.node_creator;
      if (!targetUserId || targetUserId === "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
        targetUserId = node.creator || node.owner;
      }
      personName = (targetUserId ? userNameMap[targetUserId] : undefined) || "飞书成员";
      creatorId = targetUserId;
    }

    // 确定分类：Wiki 优先使用归档分类，非 Wiki 通过目录拓扑推断
    let docPrimaryCategory = matchedWiki?.finalPrimaryCategory;
    let docSecondaryCategory = matchedWiki?.finalSecondaryCategory;
    if (!isWiki) {
      const resolved = resolveDocCategory(node);
      docPrimaryCategory = resolved.primary;
      docSecondaryCategory = resolved.secondary;
    }

    const docItem: FeishuFullDocItem = {
      nodeToken: node.node_token,
      documentToken: node.obj_token || node.node_token,
      title: node.title || (matchedWiki?.finalTitle ?? "未命名文档"),
      url: `${origin}/wiki/${node.node_token}`,
      createTime: docDate.toISOString(),
      originalCreateTime,
      creatorId,
      creatorName: personName,
      origin: originType,
      wikiId: matchedWiki?.wikiId,
      primaryCategory: docPrimaryCategory,
      secondaryCategory: docSecondaryCategory,
      parentNodeToken: node.parent_node_token,
    };
    docItems.push(docItem);

    // 同步写入持久化入库账本
    ledger[node.node_token] = {
      nodeToken: node.node_token,
      documentToken: node.obj_token || node.node_token,
      title: docItem.title,
      ingestedAt: docItem.createTime,
      originalCreateTime,
      operatorId: creatorId,
      operatorName: personName,
      source: ingestionSource,
    };
  }

  // 保存最新账本
  writeIngestionLedger(ledger);

  // 5. 按自然周聚合
  interface WeekBucket {
    weekKey: string;
    weekLabel: string;
    startDate: string;
    endDate: string;
    sortKey: number;
    isCurrentWeek: boolean;
    items: FeishuFullDocItem[];
  }

  const weekMap = new Map<string, WeekBucket>();

  // 确保当前进行中的自然周必然存在于周度桶中 (常驻展示)
  const currentWeekInfo = getISOWeekInfo(scanTime, scanTime);
  weekMap.set(currentWeekInfo.weekKey, {
    weekKey: currentWeekInfo.weekKey,
    weekLabel: currentWeekInfo.weekLabel,
    startDate: currentWeekInfo.startDate,
    endDate: currentWeekInfo.endDate,
    sortKey: currentWeekInfo.sortKey,
    isCurrentWeek: true,
    items: [],
  });

  for (const doc of docItems) {
    const docDate = new Date(doc.createTime);
    const { weekKey, weekLabel, startDate, endDate, sortKey, isCurrentWeek } = getISOWeekInfo(docDate, scanTime);

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, {
        weekKey,
        weekLabel,
        startDate,
        endDate,
        sortKey,
        isCurrentWeek,
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
      } else {
        const existing = personMap.get(pName)!;
        if (!existing.userId || existing.userId === "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
          if (item.creatorId && item.creatorId !== "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
            existing.userId = item.creatorId;
          }
        }
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
      isCurrentWeek: bucket.isCurrentWeek,
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
    } else {
      const existing = globalPersonMap.get(pName)!;
      if (!existing.userId || existing.userId === "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
        if (doc.creatorId && doc.creatorId !== "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
          existing.userId = doc.creatorId;
        }
      }
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

/**
 * 根据指定周期计算文档贡献榜及统计数据
 */
export function computeCycleStats(
  stats: TaskMigrationStats,
  cycleType: StatCycleType = "this_week",
  now = new Date(),
): CycleStatsResult {
  const weekday = chinaWeekday(now); // 1: Mon ... 7: Sun
  const todayMidnight = atShanghaiLocal(now, "00:00");
  const formatDate = chinaDateKey;
  const formatShort = (d: Date) => chinaDateKey(d).slice(5).replace("-", "/");

  let startTime: Date;
  let endTime: Date;
  let cycleShortLabel = "";
  let cycleTitle = "";
  let cycleLabel = "";

  if (cycleType === "yesterday") {
    startTime = new Date(todayMidnight.getTime() - 86400000);
    endTime = new Date(todayMidnight.getTime() - 1);
    cycleShortLabel = "昨日";
    cycleTitle = "前一天";
    cycleLabel = `前一天 (${formatShort(startTime)})`;
  } else if (cycleType === "last_week") {
    // 上个自然周：上周一 00:00 至 上周日 23:59:59
    const thisMonday = new Date(todayMidnight.getTime() - (weekday - 1) * 86400000);
    startTime = new Date(thisMonday.getTime() - 7 * 86400000);
    endTime = new Date(thisMonday.getTime() - 1);
    cycleShortLabel = "上周";
    cycleTitle = "上个自然周";
    cycleLabel = `上个自然周 (${formatShort(startTime)} - ${formatShort(endTime)})`;
  } else if (cycleType === "past_7_days") {
    // 到今天为止前七天：过去7天（7天前00:00至今天结束）
    startTime = new Date(todayMidnight.getTime() - 7 * 86400000);
    endTime = new Date(atShanghaiLocal(now, "23:59").getTime() + 59999);
    cycleShortLabel = "近7天";
    cycleTitle = "到今天为止前七天";
    cycleLabel = `到今天为止前七天 (${formatShort(startTime)} - ${formatShort(endTime)})`;
  } else {
    // this_week (默认)：本周一 00:00 至 本周日 23:59:59
    const thisMonday = new Date(todayMidnight.getTime() - (weekday - 1) * 86400000);
    startTime = thisMonday;
    endTime = new Date(thisMonday.getTime() + 7 * 86400000 - 1);
    cycleShortLabel = "本周";
    cycleTitle = "本自然周";
    cycleLabel = `本自然周 (${formatShort(startTime)} - ${formatShort(endTime)})`;
  }

  // 收集并过滤当前周期内的文档项
  const allItems = (stats.weeks || []).flatMap((w) => w.items || []);
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();

  const cycleItems = allItems.filter((item) => {
    const t = new Date(item.createTime).getTime();
    return !Number.isNaN(t) && t >= startMs && t <= endMs;
  });

  let nonWikiCount = 0;
  let wikiCount = 0;
  const personMap = new Map<string, { nonWiki: number; wiki: number; userId?: string; catMap: Map<string, number> }>();

  for (const item of cycleItems) {
    if (item.origin === "wiki_migration") {
      wikiCount++;
    } else {
      nonWikiCount++;
    }

    const pName = item.creatorName;
    if (!personMap.has(pName)) {
      personMap.set(pName, { nonWiki: 0, wiki: 0, userId: item.creatorId, catMap: new Map() });
    } else {
      const existing = personMap.get(pName)!;
      if (!existing.userId || existing.userId === "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
        if (item.creatorId && item.creatorId !== "ou_8a0d18f26e02a0a5add005b36c2d8eb8") {
          existing.userId = item.creatorId;
        }
      }
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
    cycleType,
    cycleKey: cycleType,
    cycleLabel,
    cycleShortLabel,
    cycleTitle,
    startDate: formatDate(startTime),
    endDate: formatDate(endTime),
    startTime,
    endTime,
    totalCount: cycleItems.length,
    nonWikiCount,
    wikiCount,
    persons,
    items: cycleItems.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime()),
  };
}

export interface SubdirectoryStat {
  name: string;
  totalCount: number;
  cycleCount: number;
}

export interface DirectoryStat {
  name: string;
  subdirectories: SubdirectoryStat[];
  totalCount: number;
  cycleCount: number;
}

/** 统计两个重点目录中各子目录的非 Wiki 文档，周期增量与贡献榜使用相同的文档集合。 */
export function computeSubdirectoryStats(
  stats: TaskMigrationStats,
  directories: KnowledgeDirectory[],
  cycleStats: CycleStatsResult,
): DirectoryStat[] {
  const focusedDirectories = [
    ["业务子方向", "业务方向"],
    ["基础库与通用能力", "基础库与能力"],
  ];
  const allItems = stats.weeks.flatMap((week) => week.items);
  const itemByToken = new Map(allItems.map((item) => [item.nodeToken, item]));

  return focusedDirectories.map((aliases) => {
    const directory = directories.find((item) => aliases.includes(item.title));
    const name = aliases[0];
    const knownChildren = new Map(directory?.children.map((child) => [child.nodeToken, child.title]) || []);

    const getChildName = (item: FeishuFullDocItem): string | undefined => {
      if (!directory) {
        return aliases.includes(item.primaryCategory || "") ? item.secondaryCategory : undefined;
      }
      let current: FeishuFullDocItem | undefined = item;
      let depth = 0;
      while (current?.parentNodeToken && depth++ < 30) {
        if (current.parentNodeToken === directory.nodeToken) {
          // 一级目录的直属文档与子目录节点本身不属于“子目录内的文档”。
          return current === item ? undefined : knownChildren.get(current.nodeToken) || current.title;
        }
        current = itemByToken.get(current.parentNodeToken);
      }
      return undefined;
    };

    const countByChild = (items: FeishuFullDocItem[]) => {
      const counts = new Map<string, number>();
      for (const item of items) {
        if (item.origin !== "external_feishu") continue;
        const childName = getChildName(item);
        if (childName) counts.set(childName, (counts.get(childName) || 0) + 1);
      }
      return counts;
    };
    const totals = countByChild(allItems);
    const cycle = countByChild(cycleStats.items);
    const childNames = new Set([...knownChildren.values(), ...totals.keys()]);
    const subdirectories = [...childNames].map((childName) => ({
      name: childName,
      totalCount: totals.get(childName) || 0,
      cycleCount: cycle.get(childName) || 0,
    })).sort((a, b) => b.cycleCount - a.cycleCount || b.totalCount - a.totalCount || a.name.localeCompare(b.name, "zh-CN"));

    return {
      name,
      subdirectories,
      totalCount: subdirectories.reduce((sum, child) => sum + child.totalCount, 0),
      cycleCount: subdirectories.reduce((sum, child) => sum + child.cycleCount, 0),
    };
  });
}
