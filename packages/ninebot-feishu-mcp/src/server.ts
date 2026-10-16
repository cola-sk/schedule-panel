#!/usr/bin/env node

import { randomUUID } from "crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createFeishuMcpServer } from "./mcp-server";
import { initEnvironment } from "./config";

// 载入环境变量
initEnvironment();

const PORT = parseInt(process.env.FEISHU_MCP_PORT || "9798", 10);
const HOST = process.env.FEISHU_MCP_HOST || "0.0.0.0";

export function startMcpHttpServer(port = PORT, host = HOST) {
  const app = createMcpExpressApp();
  const transports = new Map<string, StreamableHTTPServerTransport | SSEServerTransport>();

  // 1. 健康探活与工具自省
  app.get("/health", (req: any, res: any) => {
    const appId = process.env.FEISHU_APP_ID;
    res.json({
      name: "@ninebot/feishu-mcp",
      version: "1.0.0",
      status: "running",
      port,
      feishuAppConfigured: Boolean(appId),
      endpoints: {
        streamableHttp: `http://127.0.0.1:${port}/mcp`,
        sse: `http://127.0.0.1:${port}/sse`,
        messages: `http://127.0.0.1:${port}/messages`,
      },
    });
  });

  // 2. Streamable HTTP 处理核心函数
  async function handleStreamableHttpRequest(req: any, res: any) {
    try {
      const sessionId = (req.headers["mcp-session-id"] as string) || req.query.sessionId;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        const existing = transports.get(sessionId);
        if (existing instanceof StreamableHTTPServerTransport) {
          transport = existing;
        } else {
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: Session exists but uses a different transport protocol",
            },
            id: null,
          });
          return;
        }
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            console.log(`[MCP] StreamableHTTP 会话初始化成功: ${newSessionId}`);
            transports.set(newSessionId, transport!);
          },
        });

        transport.onclose = () => {
          const sid = transport?.sessionId;
          if (sid) {
            console.log(`[MCP] StreamableHTTP 会话已关闭: ${sid}`);
            transports.delete(sid);
          }
        };

        const server = createFeishuMcpServer();
        await server.connect(transport);
      } else if (sessionId) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: `Session not found: ${sessionId}`,
          },
          id: null,
        });
        return;
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        const server = createFeishuMcpServer();
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
      console.error("[MCP] 处理 Streamable HTTP 请求异常:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error.message || "Internal server error",
          },
          id: null,
        });
      }
    }
  }

  // 注册 Streamable HTTP 端点：/mcp
  app.all("/mcp", handleStreamableHttpRequest);

  // 3. 经典 HTTP+SSE 协议端点
  app.get("/sse", async (req: any, res: any) => {
    console.log(`[MCP] 收到 SSE 连接请求: ${req.headers["user-agent"] || "unknown"}`);
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;

    transports.set(sessionId, transport);
    res.on("close", () => {
      console.log(`[MCP] SSE 连接断开，注销 Session: ${sessionId}`);
      transports.delete(sessionId);
    });

    const server = createFeishuMcpServer();
    await server.connect(transport);
  });

  app.post("/messages", async (req: any, res: any) => {
    const sessionId = (req.query.sessionId as string) || (req.headers["mcp-session-id"] as string);
    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId parameter" });
      return;
    }

    const transport = transports.get(sessionId);
    if (transport instanceof SSEServerTransport) {
      await transport.handlePostMessage(req, res, req.body);
    } else if (transport instanceof StreamableHTTPServerTransport) {
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(404).json({ error: `Session not found: ${sessionId}` });
    }
  });

  // 4. 根路径兼容
  app.all("/", async (req: any, res: any) => {
    if (req.method === "GET") {
      res.redirect("/health");
      return;
    }
    return handleStreamableHttpRequest(req, res);
  });

  const httpServer = app.listen(port, host, () => {
    console.log("==================================================");
    console.log(`🚀 九号前端飞书文档 MCP HTTP Server 已成功启动!`);
    console.log(`- 监听地址: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);
    console.log(`- Streamable HTTP 端点: http://127.0.0.1:${port}/mcp`);
    console.log(`- SSE 端点: http://127.0.0.1:${port}/sse`);
    console.log(`- 健康检查: http://127.0.0.1:${port}/health`);
    console.log("==================================================");
  });

  const handleShutdown = () => {
    console.log("\n正在安全关闭 MCP Server...");
    httpServer.close(() => {
      console.log("服务已平稳停止");
      process.exit(0);
    });
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  return httpServer;
}

if (require.main === module) {
  startMcpHttpServer();
}
