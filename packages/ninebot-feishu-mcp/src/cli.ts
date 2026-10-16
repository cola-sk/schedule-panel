#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFeishuMcpServer } from "./mcp-server";
import { initEnvironment } from "./config";

// 自动载入可能存在的环境变量文件
initEnvironment();

async function main() {
  const server = createFeishuMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ninebot-feishu-mcp] Stdio transport connected and ready.");
}

main().catch((err) => {
  console.error("[ninebot-feishu-mcp] Fatal error:", err);
  process.exit(1);
});
