import type { CollectorStats, McpTelemetryEvent } from "./types.js";

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

  constructor(options?: { maxStoredEvents?: number }) {
    this.maxStoredEvents = options?.maxStoredEvents || 200;
  }

  /**
   * 写入事件
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

      // 维护环形最新事件列表
      this.recentEvents.unshift(event);
      if (this.recentEvents.length > this.maxStoredEvents) {
        this.recentEvents.pop();
      }

      // 控制台输出结构化 JSON 日志（Vercel Logs 及任何现代容器日志收集器均天然友好）
      this.logToConsole(event);
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

    // 单行格式化 JSON，便于 Vercel 日志过滤与聚合
    console.log(JSON.stringify(logEntry));
  }

  /**
   * 获取聚合状态指标
   */
  public getStats(): CollectorStats {
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
