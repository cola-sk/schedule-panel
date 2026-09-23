export type PrimaryCategory = string;
export type SecondaryCategory = string;
export type DynamicTaxonomy = Record<PrimaryCategory, SecondaryCategory[]>;
export type MigrationStatus = "discovered" | "pending_review" | "approved" | "migrating" | "migrated" | "failed" | "skipped";
export type ConfluenceAuthType = "pat" | "basic" | "cookie";

export interface LLMConfig {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  updatedAt?: string;
}

export interface KnowledgeTaskConfig {
  confluenceBaseUrl: string;
  confluenceRootPageId: string;
  confluenceAuthType: ConfluenceAuthType;
  confluenceUsername?: string;
  confluenceSecret?: string;
  targetWikiRoot: string;
  defaultOperatorName: string;
  updatedAt?: string;
}

// 保留用于历史数据读取和兼容
export interface KnowledgeMigrationConfig extends KnowledgeTaskConfig {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
}

export interface SourceDocument {
  pageId: string;
  url: string;
  title: string;
  path: string[];
  parentId?: string;
  ancestors?: Array<{ id: string; title: string }>;
  version: number;
  contentHash: string;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
  contentEmpty?: boolean;
  contentLength?: number;
}

export interface CategorySuggestion {
  primaryCategory?: PrimaryCategory;
  secondaryCategory?: SecondaryCategory;
  confidence?: number;
  reason?: string;
  summary?: string;
  error?: string;
}

export interface KnowledgeMigrationItem {
  id: string; // Wiki 唯一 ID (pageId)
  wikiId: string; // Wiki 唯一 ID (pageId)
  taskId: string;
  jobId?: string;
  source: SourceDocument;
  suggestion: CategorySuggestion;
  finalTitle: string;
  finalPrimaryCategory?: PrimaryCategory;
  finalSecondaryCategory?: SecondaryCategory;
  status: MigrationStatus;
  approvedBy?: string;
  approvedAt?: string;
  migratedAt?: string;
  targetNodeToken?: string;
  targetDocumentToken?: string;
  targetParentNodeToken?: string;
  targetUrl?: string;
  error?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  // 树与内容标记
  isFolder?: boolean;
  isCurrentRoot?: boolean;
  contentEmpty?: boolean;
}

export interface WikiTreeNode {
  id: string; // Wiki 唯一 ID (pageId)
  title: string;
  parentId?: string;
  url: string;
  path: string[];
  hasChildren: boolean;
  children: WikiTreeNode[];
  status?: MigrationStatus;
  counts?: {
    total: number;
    migrated: number;
    pending: number;
    failed: number;
    skipped: number;
  };
}

export interface KnowledgeMigrationJob {
  id: string;
  status: "running" | "completed" | "completed_with_errors" | "failed";
  total: number;
  processed: number;
  failed: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface KnowledgeMigrationAuditLog {
  id: string;
  wikiId?: string;
  itemId?: string;
  action:
    | "scan_started"
    | "scan_completed"
    | "tree_synced"
    | "target_directories_synced"
    | "item_updated"
    | "approved"
    | "skipped"
    | "migration_started"
    | "migration_succeeded"
    | "migration_failed";
  operator?: string;
  detail?: string;
  createdAt: string;
}

export interface KnowledgeDirectory {
  title: string;
  nodeToken: string;
  children: Array<{ title: string; nodeToken: string }>;
}

export interface TaskNotifyConfig {
  enabled: boolean;
  botId?: string; // 选中的系统已有机器人 ID
  webhookUrl?: string; // Webhook 地址（可从 botId 自动解析或手动配置）
  dayOfWeek: number; // 1-7, 1: 周一 ... 5: 周五 ... 7: 周日
  time: string; // 如 "18:00"
  lastSentAt?: string;
  sendMode?: "both" | "image_only" | "text_only"; // 图文一起发送 (默认 both) | 仅发送长图 | 仅发送文字卡片
}

export interface KnowledgeMigrationTask {
  id: string;
  name: string;
  description?: string;
  config: KnowledgeTaskConfig;
  tree?: WikiTreeNode[];
  treeUpdatedAt?: string;
  targetDirectories?: KnowledgeDirectory[];
  targetDirectoriesUpdatedAt?: string;
  notifyConfig?: TaskNotifyConfig;
  stats?: TaskMigrationStats;
  statsUpdatedAt?: string;
  jobs: KnowledgeMigrationJob[];
  items: Record<string, KnowledgeMigrationItem>; // 以 wikiId 为键
  auditLogs: KnowledgeMigrationAuditLog[];
  createdAt: string;
  updatedAt: string;
}

export type MigrationDocOrigin = "wiki_migration" | "external_feishu";

export interface FeishuFullDocItem {
  nodeToken: string;
  documentToken: string;
  title: string;
  url: string;
  createTime: string; // ISO 格式时间
  creatorId?: string;
  creatorName: string;
  origin: MigrationDocOrigin;
  wikiId?: string;
  primaryCategory?: string;
  secondaryCategory?: string;
  parentNodeToken?: string;
}

export interface PersonCategoryCount {
  category: string;
  count: number;
}

export interface MigrationPersonStat {
  personName: string;
  userId?: string;
  nonWikiCount: number; // 除 Wiki 之外迁移/新建的文档数
  wikiCount: number;    // Wiki 归档系统迁移的文档数
  totalCount: number;   // 总文档数
  categories?: PersonCategoryCount[]; // 该成员非 Wiki 文档的分类分布
}

export interface MigrationWeeklyStat {
  weekKey: string;     // 如 "2026-W38"
  weekLabel: string;   // 如 "2026年第38周 (09/14 - 09/20)"
  startDate: string;   // "2026-09-14"
  endDate: string;     // "2026-09-20"
  totalCount: number;
  nonWikiCount: number; // 除 Wiki 之外迁移/新建的文档数
  wikiCount: number;    // Wiki 归档系统迁移的文档数
  persons: MigrationPersonStat[];
  items: FeishuFullDocItem[];
}

export interface TaskMigrationStats {
  taskId: string;
  totalFeishuDocs: number;
  totalNonWikiDocs: number;
  totalWikiDocs: number;
  totalPersons: number;
  personsRank: MigrationPersonStat[];
  categoryRank?: PersonCategoryCount[]; // 非 Wiki 文档的全局分类累计统计
  weeks: MigrationWeeklyStat[];
  updatedAt: string;
}

export interface KnowledgeMigrationState {
  llmConfig: LLMConfig;
  tasks: KnowledgeMigrationTask[];
  activeTaskId?: string;
  // 旧结构兼容字段
  config?: KnowledgeMigrationConfig;
  directoryTree?: KnowledgeDirectory[];
  directoryUpdatedAt?: string;
  jobs?: KnowledgeMigrationJob[];
  items?: KnowledgeMigrationItem[];
  auditLogs?: KnowledgeMigrationAuditLog[];
}

export type ItemFilters = {
  status?: MigrationStatus;
  tab?: "all" | "pending" | "migrated" | "failed";
  selectedWikiId?: string;
  wikiId?: string;
  primaryCategory?: PrimaryCategory;
  secondaryCategory?: string;
  keyword?: string;
  createdBy?: string;
  updatedBy?: string;
  approvedBy?: string;
  jobId?: string;
};

export function taxonomyFromDirectories(directories: KnowledgeDirectory[] | undefined): DynamicTaxonomy {
  return Object.fromEntries(
    (directories ?? []).map((directory) => [directory.title, (directory.children || []).map((child) => child.title)])
  );
}

export function isValidCategory(
  primary: string | undefined,
  secondary: string | undefined,
  taxonomy: Record<string, readonly string[] | string[]>
): boolean {
  if (!primary || !taxonomy[primary]) return false;
  const sec = secondary?.trim();
  if (!sec) return true;
  return taxonomy[primary]?.includes(sec) || false;
}

function cleanString(str: string): string {
  return str.toLowerCase().replace(/[\s\-_/\\()（）·,，.。:：]/g, "");
}

/**
 * 语义化模糊匹配与归一化：将用户参考准则、模型推测可能带有的微小差异（标点、别名、括号等）
 * 精准映射到目标飞书知识库实际的一级和二级目录中。
 */
export function resolveCategory(
  rawPrimary: string | undefined,
  rawSecondary: string | undefined,
  taxonomy: DynamicTaxonomy
): { primary?: PrimaryCategory; secondary?: SecondaryCategory } {
  const primaries = Object.keys(taxonomy);
  if (!primaries.length) return {};

  let matchedPrimary: PrimaryCategory | undefined;
  const pInput = rawPrimary?.trim() || "";
  const pClean = cleanString(pInput);

  // 1. 一级目录完全匹配
  if (taxonomy[pInput]) {
    matchedPrimary = pInput;
  } else if (pClean) {
    // 2. 清理标点/空格后匹配
    matchedPrimary = primaries.find((p) => cleanString(p) === pClean);

    // 3. 关键字与别名语义兜底映射（将参考准则与常见别名映射到真实飞书一级类）
    if (!matchedPrimary) {
      if (/规范|制度|流程|标准|合规|准则/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /规范|标准/.test(p));
      } else if (/方案|架构|设计|技术选型/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /方案|架构/.test(p));
      } else if (/组件|基础库|sdk|通用库|插件|物料/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /基础库|能力|组件/.test(p));
      } else if (/工程|效能|工具|构建|调试|编译|脚手架|cicd|ci\/cd|流水线/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /工程|效能/.test(p));
      } else if (/排查|应急|监控|运维|故障|告警|报警|指标/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /监控|运维/.test(p));
      } else if (/ai|mcp|skill|agent|大模型/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /ai/.test(cleanString(p)));
      } else if (/复盘|总结|分享|成长|经验|学习|新人|新人文档/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /知识|成长/.test(p));
      } else if (/项目|协作|跟进|周会|会议/.test(pClean)) {
        matchedPrimary = primaries.find((p) => /协作|项目/.test(p));
      }
    }
  }

  // 4. 若一级目录仍未匹配到，但二级目录存在，尝试反向推导一级目录
  const sInput = rawSecondary?.trim() || "";
  const sClean = cleanString(sInput);

  if (!matchedPrimary && sClean) {
    for (const [p, secondaries] of Object.entries(taxonomy)) {
      if (secondaries.some((s) => cleanString(s) === sClean || cleanString(s).includes(sClean) || sClean.includes(cleanString(s)))) {
        matchedPrimary = p;
        break;
      }
    }
  }

  if (!matchedPrimary) {
    return {};
  }

  const secondaries = taxonomy[matchedPrimary] || [];
  if (secondaries.length === 0) {
    return { primary: matchedPrimary, secondary: "" };
  }

  // 5. 匹配二级目录
  let matchedSecondary: SecondaryCategory | undefined;
  if (secondaries.includes(sInput)) {
    matchedSecondary = sInput;
  } else if (sClean) {
    // 包含或清理后等价
    matchedSecondary =
      secondaries.find((s) => cleanString(s) === sClean) ||
      secondaries.find((s) => cleanString(s).includes(sClean) || sClean.includes(cleanString(s)));

    // 二级别名语义映射
    if (!matchedSecondary) {
      if (/cr|代码规范|eslint|代码风格/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /代码规范/.test(s));
      } else if (/流程|研发流程|发布流程|上线流程/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /研发流程|发布/.test(s));
      } else if (/制度|团队制度|考勤|管理/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /制度/.test(s));
      } else if (/选型|技术选型/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /选型/.test(s));
      } else if (/优化|性能/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /性能/.test(s));
      } else if (/架构|系统设计/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /架构/.test(s));
      } else if (/方案|技术方案/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /技术方案|方案/.test(s));
      } else if (/sdk/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /sdk/i.test(s));
      } else if (/ui|组件/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /组件/.test(s));
      } else if (/脚手架|模板|模版/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /脚手架|模板/.test(s));
      } else if (/cicd|ci|cd|部署|发布|流水线/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /cicd|部署/i.test(s));
      } else if (/测试|质量|单元测试|自动化测试/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /测试|质量/.test(s));
      } else if (/构建|编译|webpack|vite|rollup/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /构建|编译/.test(s));
      } else if (/开发|调试|本地/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /调试|开发/.test(s));
      } else if (/排查|手册|故障/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /故障|排查/.test(s));
      } else if (/监控|报警|告警/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /监控|报警/.test(s));
      } else if (/复盘|事故/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /复盘/.test(s));
      } else if (/总结/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /总结/.test(s));
      } else if (/分享|培训/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /分享/.test(s));
      } else if (/新人|入职/.test(sClean)) {
        matchedSecondary = secondaries.find((s) => /新人/.test(s));
      }
    }
  }

  // 若二级未匹配上但该一级类下有二级类，默认取其最相关的第一个子类作为兜底
  if (!matchedSecondary && secondaries.length > 0) {
    matchedSecondary = secondaries[0];
  }

  return {
    primary: matchedPrimary,
    secondary: matchedSecondary || "",
  };
}

