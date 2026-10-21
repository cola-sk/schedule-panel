import type { CollectorStats, McpTelemetryEvent } from "./types.js";

export interface SupabaseStorageStatus {
  configured: boolean;
  urlProvided: boolean;
  keyProvided: boolean;
  lastAttemptTime?: string;
  lastSuccess?: boolean;
  lastStatusCode?: number;
  lastError?: string;
}

/**
 * 监控数据持久化与统计管理
 */
export class TelemetryStorage {
  private recentEvents: McpTelemetryEvent[] = [];
  private maxStoredEvents: number;

  private totalCount = 0;
  private successCount = 0;
  private failCount = 0;
  private searchCount = 0;
  private indexHitCount = 0;

  private queryCounts = new Map<string, number>();
  private projectCounts = new Map<string, number>();

  // 记录 Supabase 连接与写入健康状态
  private supabaseStatus: SupabaseStorageStatus = {
    configured: false,
    urlProvided: false,
    keyProvided: false,
  };

  constructor(options?: { maxStoredEvents?: number }) {
    this.maxStoredEvents = options?.maxStoredEvents || 200;
  }

  /**
   * 写入事件并持久化到 Supabase
   */
  public record(events: McpTelemetryEvent[]): void {
    for (const event of events) {
      this.totalCount++;
      if (event.success) {
        this.successCount++;
      } else {
        this.failCount++;
      }

      if (event.toolName === "feishu_search_wiki" || event.query) {
        this.searchCount++;
        if (event.hasIndexed) {
          this.indexHitCount++;
        }
        if (event.query) {
          const q = event.query.trim().toLowerCase();
          this.queryCounts.set(q, (this.queryCounts.get(q) || 0) + 1);
        }
      }

      const project = event.environment?.projectName || "unknown";
      this.projectCounts.set(project, (this.projectCounts.get(project) || 0) + 1);

      // 维护环形最新事件列表 (供内存 stats 快速展示)
      this.recentEvents.unshift(event);
      if (this.recentEvents.length > this.maxStoredEvents) {
        this.recentEvents.pop();
      }

      // 控制台输出结构化 JSON 日志（Vercel Logs）
      this.logToConsole(event);
    }

    // 异步非阻塞持久化到 Supabase（纯原生 REST API，零多余依赖）
    void this.saveToSupabase(events);
  }

  /**
   * 异步将原始事件批量持久化到 Supabase 数据表 mcp_telemetry_logs
   */
  public async saveToSupabase(events: McpTelemetryEvent[]): Promise<boolean> {
    const supabaseUrl = (
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL
    )?.replace(/\/$/, "");

    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    this.supabaseStatus.urlProvided = Boolean(supabaseUrl);
    this.supabaseStatus.keyProvided = Boolean(supabaseKey);
    this.supabaseStatus.configured = Boolean(supabaseUrl && supabaseKey);
    this.supabaseStatus.lastAttemptTime = new Date().toISOString();

    if (!supabaseUrl || !supabaseKey) {
      this.supabaseStatus.lastSuccess = false;
      this.supabaseStatus.lastError = `未检测到有效环境变量: URL=${Boolean(supabaseUrl)}, KEY=${Boolean(supabaseKey)}`;
      return false;
    }

    try {
      const rows = events.map((event) => ({
        event_id: event.eventId,
        created_at: event.timestamp || new Date().toISOString(),
        tool_name: event.toolName,
        duration_ms: event.durationMs || 0,
        success: Boolean(event.success),
        error_message: event.errorMessage || null,
        client_type: event.environment?.clientType || null,
        project_name: event.environment?.projectName || null,
        git_repo: event.environment?.gitRepo || null,
        git_branch: event.environment?.gitBranch || null,
        platform: event.environment?.platform || null,
        node_version: event.environment?.nodeVersion || null,
        mcp_version: event.environment?.mcpVersion || null,
        query: event.query || null,
        has_indexed: event.hasIndexed !== undefined ? Boolean(event.hasIndexed) : null,
        result_count: event.resultCount !== undefined ? event.resultCount : 0,
        search_source: event.searchSource || null,
        results_summary: event.resultsSummary || null,
        metadata: event.metadata || {},
      }));

      const endpoint = `${supabaseUrl}/rest/v1/mcp_telemetry_logs`;
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 4000) : null;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(rows),
        signal: controller?.signal,
      });

      if (timeout) clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        this.supabaseStatus.lastSuccess = false;
        this.supabaseStatus.lastStatusCode = res.status;
        this.supabaseStatus.lastError = errorText || `HTTP status ${res.status}`;
        console.error(`[Supabase Storage Error] Status ${res.status}: ${errorText}`);
        return false;
      }

      this.supabaseStatus.lastSuccess = true;
      this.supabaseStatus.lastStatusCode = res.status;
      this.supabaseStatus.lastError = undefined;
      return true;
    } catch (err: any) {
      this.supabaseStatus.lastSuccess = false;
      this.supabaseStatus.lastError = err.message || String(err);
      console.error("[Supabase Storage Network Error]", err.message || err);
      return false;
    }
  }

  /**
   * 结构化日志输出
   */
  private logToConsole(event: McpTelemetryEvent): void {
    const logEntry = {
      level: event.success ? "INFO" : "WARN",
      tag: "MCP_TELEMETRY",
      eventId: event.eventId,
      timestamp: event.timestamp,
      tool: event.toolName,
      project: event.environment?.projectName || "unknown",
      client: event.environment?.clientType || "unknown",
      durationMs: event.durationMs,
      success: event.success,
      query: event.query,
      hasIndexed: event.hasIndexed,
      resultCount: event.resultCount,
      error: event.errorMessage,
    };

    console.log(JSON.stringify(logEntry));
  }

  /**
   * 获取聚合状态指标
   */
  public getStats(): CollectorStats & { supabase?: SupabaseStorageStatus } {
    const topQueries = Array.from(this.queryCounts.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topProjects = Array.from(this.projectCounts.entries())
      .map(([project, count]) => ({ project, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const hitRate =
      this.searchCount > 0
        ? `${((this.indexHitCount / this.searchCount) * 100).toFixed(1)}%`
        : "N/A";

    return {
      totalEvents: this.totalCount,
      successfulEvents: this.successCount,
      failedEvents: this.failCount,
      searchEvents: this.searchCount,
      indexedHits: this.indexHitCount,
      indexHitRate: hitRate,
      topQueries,
      topProjects,
      recentEvents: this.recentEvents.slice(0, 50),
      supabase: this.supabaseStatus,
    };
  }

  /**
   * 重置内存计数（主要用于测试）
   */
  public reset(): void {
    this.recentEvents = [];
    this.totalCount = 0;
    this.successCount = 0;
    this.failCount = 0;
    this.searchCount = 0;
    this.indexHitCount = 0;
    this.queryCounts.clear();
    this.projectCounts.clear();
  }
}

// 导出全局默认单例
export const defaultStorage = new TelemetryStorage();
