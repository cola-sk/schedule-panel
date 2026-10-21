import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";
import { defaultStorage, TelemetryStorage } from "./storage.js";
import type {
  McpTelemetryEvent,
  TelemetryReportRequest,
  TelemetryReportResponse,
} from "./types.js";

/**
 * 创建 Telemetry Collector Hono 应用
 */
export function createCollectorApp(storage: TelemetryStorage = defaultStorage) {
  const app = new Hono();

  // 跨域支持
  app.use("*", cors());

  // 1. 健康检查
  const rootHandler = (c: any) => {
    return c.json({
      service: "ninebot-mcp-telemetry-collector",
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    });
  };

  app.get("/", rootHandler);
  app.get("/api", rootHandler);
  app.get("/health", (c) => c.json({ status: "ok" }));

  // 2. 接收监控上报（支持单个或批量）
  const handleReport = async (c: any) => {
    try {
      const body = await c.req.json().catch(() => null);
      if (!body) {
        return c.json({ success: false, error: "Invalid JSON body" }, 400);
      }

      const rawEvents: unknown[] = Array.isArray(body) ? body : [body];
      const validEvents: McpTelemetryEvent[] = [];

      for (const item of rawEvents) {
        if (typeof item === "object" && item !== null && "toolName" in item) {
          const raw = item as Record<string, any>;
          const event: McpTelemetryEvent = {
            eventId: String(raw.eventId || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
            timestamp: String(raw.timestamp || new Date().toISOString()),
            durationMs: Number(raw.durationMs) || 0,
            toolName: String(raw.toolName),
            success: Boolean(raw.success),
            errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
            environment: {
              clientType: raw.environment?.clientType || "unknown",
              projectName: raw.environment?.projectName,
              gitRepo: raw.environment?.gitRepo,
              gitBranch: raw.environment?.gitBranch,
              platform: raw.environment?.platform,
              arch: raw.environment?.arch,
              nodeVersion: raw.environment?.nodeVersion,
              mcpVersion: raw.environment?.mcpVersion,
              userAlias: raw.environment?.userAlias,
            },
            query: raw.query ? String(raw.query) : undefined,
            hasIndexed: raw.hasIndexed !== undefined ? Boolean(raw.hasIndexed) : undefined,
            resultCount: raw.resultCount !== undefined ? Number(raw.resultCount) : undefined,
            resultsSummary: Array.isArray(raw.resultsSummary) ? raw.resultsSummary : undefined,
            searchSource: raw.searchSource ? String(raw.searchSource) : undefined,
            metadata: typeof raw.metadata === "object" ? raw.metadata : undefined,
          };
          validEvents.push(event);
        }
      }

      if (validEvents.length === 0) {
        return c.json({ success: false, error: "No valid telemetry events provided" }, 400);
      }

      storage.record(validEvents);

      const response: TelemetryReportResponse = {
        success: true,
        receivedCount: validEvents.length,
      };
      return c.json(response, 200);
    } catch (err: any) {
      console.error("[Collector Error]", err);
      return c.json({ success: false, error: err.message || "Internal server error" }, 500);
    }
  };

  app.post("/api/v1/report", handleReport);
  app.post("/api/report", handleReport);

  // 3. 统计概览查询
  app.get("/api/v1/stats", (c) => {
    // 若配置了 STATS_TOKEN，可进行轻量权限保护
    const requiredToken = process.env.TELEMETRY_STATS_TOKEN;
    if (requiredToken) {
      const authHeader = c.req.header("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token !== requiredToken) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    const stats = storage.getStats();
    return c.json({
      success: true,
      stats,
      generatedAt: new Date().toISOString(),
    });
  });

  return app;
}

export const app = createCollectorApp();

// 导出 Vercel / Node.js Serverless Function 标准默认处理函数
export default handle(app);
