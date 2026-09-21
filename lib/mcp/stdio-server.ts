import path from "path";
import fs from "fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFeishuMcpServer } from "./mcp-server";

// 加载环境变量（注意环境变量位于 FEB 项目根目录）
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

const PROJECT_ROOT = path.resolve(__dirname, "../..");
loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
loadEnvFile(path.join(PROJECT_ROOT, ".env"));

async function run() {
  const server = createFeishuMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Feishu-MCP] Stdio server connected and running ready.");
}

run().catch((err) => {
  console.error("[Feishu-MCP] Fatal error running stdio server:", err);
  process.exit(1);
});
