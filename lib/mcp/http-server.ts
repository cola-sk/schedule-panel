import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createFeishuMcpServer } from "./mcp-server";

// 环境变量加载
function loadEnvFile(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        process.env[key] = value.replace(/^["'](.*)["']$/, "$1");
      }
    }
  } catch {
    // ignore
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

const PORT = parseInt(process.env.FEISHU_MCP_PORT || "9798", 10);
const HOST = process.env.FEISHU_MCP_HOST || "0.0.0.0";

const app = createMcpExpressApp();

// 保存所有 Transport 实例（支持 StreamableHTTP 和 SSE）
const transports = new Map<string, StreamableHTTPServerTransport | SSEServerTransport>();

// 1. 健康探活与工具自省
app.get("/health", (req: any, res: any) => {
  const appId = process.env.FEISHU_APP_ID;
  res.json({
    name: "feishu-document-mcp",
    version: "1.0.0",
    status: "running",
    port: PORT,
    feishuAppConfigured: Boolean(appId),
    endpoints: {
      streamableHttp: `http://127.0.0.1:${PORT}/mcp`,
      sse: `http://127.0.0.1:${PORT}/sse`,
      messages: `http://127.0.0.1:${PORT}/messages`,
    },
    tools: [
      {
        name: "feishu_read_document",
        description: "读取飞书云文档 (Docx)、知识库 (Wiki) 或表格内容，转为 Markdown",
      },
      {
        name: "feishu_create_document",
        description: "在飞书创建新云文档 (Docx)，可指定标题、文件夹与初始 Markdown 内容",
      },
      {
        name: "feishu_append_document",
        description: "向现有飞书文档追加 Markdown 格式内容",
      },
      {
        name: "feishu_update_document",
        description: "全量更新/覆盖飞书文档正文内容（清空旧正文并替换为新的 Markdown 内容）",
      },
      {
        name: "feishu_patch_block",
        description: "局部更新/修改飞书文档中的指定块 (Block) 文本内容",
      },
      {
        name: "feishu_get_document_info",
        description: "获取飞书文档的基本元信息（标题、版本等）",
      },
    ],
  });
});

// 2. Streamable HTTP 处理核心函数（支持 /mcp 和 / 端点）
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
      // 客户端发起无 session 的 initialize 请求
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
      // 客户端传入了不存在或已过期的 sessionId
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
      // 针对无 session 且非 initialize 的直接请求（如单次无状态调用）
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
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

// 4. 根路径兼容：如果客户端向根路径 POST，视为 Streamable HTTP；如果是 GET，提供探活
app.all("/", async (req: any, res: any, next: any) => {
  if (req.method === "GET") {
    // 浏览器访问返回健康信息
    res.redirect("/health");
    return;
  }
  return handleStreamableHttpRequest(req, res);
});

const server = app.listen(PORT, HOST, () => {
  console.log("==================================================");
  console.log(`🚀 飞书文档 MCP HTTP Server 已成功启动!`);
  console.log(`- 监听地址: http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`);
  console.log(`- Streamable HTTP 端点: http://127.0.0.1:${PORT}/mcp`);
  console.log(`- SSE 端点: http://127.0.0.1:${PORT}/sse`);
  console.log(`- 健康检查: http://127.0.0.1:${PORT}/health`);
  console.log("==================================================");
});

const handleShutdown = () => {
  console.log("\n正在安全关闭 MCP Server...");
  server.close(() => {
    console.log("服务已平稳停止");
    process.exit(0);
  });
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
