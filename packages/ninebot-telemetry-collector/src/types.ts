/**
 * MCP 客户端环境信息
 */
export interface EnvironmentInfo {
  /** 宿主应用，例如 'cursor' | 'claude-desktop' | 'antigravity' | 'vscode' | 'terminal' | 'unknown' */
  clientType?: string;
  /** 当前工作区/项目名称（已脱敏，如 'frontend-core'） */
  projectName?: string;
  /** Git 仓库标识（如 'ninebot/frontend-repo'） */
  gitRepo?: string;
  /** 当前 Git 分支（如 'main', 'feat/login'） */
  gitBranch?: string;
  /** 操作系统平台 ('darwin' | 'linux' | 'win32') */
  platform?: string;
  /** 操作系统架构 ('arm64' | 'x64') */
  arch?: string;
  /** Node.js 版本 (如 'v22.2.0') */
  nodeVersion?: string;
  /** MCP 包版本号 (如 '1.0.4') */
  mcpVersion?: string;
  /** 匿名用户标识哈希 (用于统计活跃开发者数) */
  userAlias?: string;
}

/**
 * 搜索召回单项摘要
 */
export interface SearchResultSummary {
  /** 标题 */
  title: string;
  /** 访问链接 */
  url: string;
  /** WikiToken 或 DocumentId */
  token?: string;
  /** 数据来源: 'team_index' | 'official' | 'wiki_tree' 等 */
  source?: string;
  /** 相关度打分 */
  score?: number;
}

/**
 * MCP 监控上报核心事件载荷
 */
export interface McpTelemetryEvent {
  /** 唯一事件ID (UUID) */
  eventId: string;
  /** 记录产生时间 (ISO 8601 字符串) */
  timestamp: string;
  /** 执行耗时 (毫秒) */
  durationMs: number;
  /** 调用的 MCP 工具名称，例如 'feishu_search_wiki' | 'feishu_read_document' */
  toolName: string;
  /** 是否成功响应给客户端 */
  success: boolean;
  /** 错误信息摘要（仅失败时填充） */
  errorMessage?: string;

  /** 请求的环境与项目上下文 */
  environment: EnvironmentInfo;

  // ---------- 搜索特定字段（针对检索类工具） ----------
  /** 搜索关键词/用户检索词 */
  query?: string;
  /** 是否搜索到/命中了权威索引 */
  hasIndexed?: boolean;
  /** 搜索结果召回总数 */
  resultCount?: number;
  /** 召回的前 N 条结果摘要（不包含大正文，保护隐私与带宽） */
  resultsSummary?: SearchResultSummary[];
  /** 搜索模式或主来源 ('team_index' | 'official' | 'wiki_tree' | 'mixed' | 'none') */
  searchSource?: string;

  // ---------- 扩展元数据 ----------
  /** 附加参数（如 space_id, parent_node_token 等） */
  metadata?: Record<string, unknown>;
}

/**
 * 上报请求的 Body，支持单个事件或批量事件
 */
export type TelemetryReportRequest = McpTelemetryEvent | McpTelemetryEvent[];

/**
 * 上报接口响应
 */
export interface TelemetryReportResponse {
  success: boolean;
  receivedCount: number;
  message?: string;
}

/**
 * 服务端聚合统计状态
 */
export interface CollectorStats {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  searchEvents: number;
  indexedHits: number;
  indexHitRate: string;
  topQueries: Array<{ query: string; count: number }>;
  topProjects: Array<{ project: string; count: number }>;
  recentEvents: McpTelemetryEvent[];
}
