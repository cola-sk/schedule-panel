import path from "path";
import fs from "fs";
import os from "os";

// ==================== 九号前端研发默认常量 ====================
export const NINEBOT_DEFAULTS = {
  /** 前端研发部知识库空间 ID */
  SPACE_ID: "7680762028796972249",
  /** 《前端工程化规范与能力导航索引》Wiki Token */
  INDEX_NODE_TOKEN: "HET8wUwdgivtMtkp7QocSD9pn2e",
  /** 限制父目录：规范与标准 + 基础库与通用能力 */
  PARENT_NODE_TOKENS: "AZ5awBTNviWQvEkFIkIcjsYJnae,Q9BlwNIfaiUhP5kyOvbc5RSxndc",
  /** 九号飞书 Web 域名 */
  WEB_ORIGIN: "https://segway-ninebot.feishu.cn",
};

/**
 * 环境变量文件解析与轻量加载器
 */
export function loadEnvFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value.replace(/^["'](.*)["']$/, "$1");
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 自动从多个潜在目录（当前工作目录、用户主目录、项目根目录）载入 .env
 */
export function initEnvironment(): void {
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".ninebot-feishu-mcp.env"),
    path.join(os.homedir(), ".feishu-mcp.env"),
    path.resolve(__dirname, "../../.env.local"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../../.env.local"),
    path.resolve(__dirname, "../../../.env"),
  ];

  for (const envPath of candidates) {
    loadEnvFile(envPath);
  }
}

// 初始化环境变量
initEnvironment();

/**
 * 获取当前飞书应用凭证
 */
export function getAppCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      "未检测到飞书应用凭证，请在环境变量或 .env.local 中配置 FEISHU_APP_ID 与 FEISHU_APP_SECRET。\n" +
      "如需团队公共只读凭证，请查阅九号前端团队内部 MCP 接入指南。"
    );
  }

  return { appId, appSecret };
}

/**
 * 获取知识库默认配置（带九号前端团队兜底）
 */
export function getWikiConfig(): {
  spaceId: string;
  indexNodeToken: string;
  parentNodeTokens: string;
  webOrigin: string;
} {
  return {
    spaceId: process.env.FEISHU_WIKI_SPACE_ID || NINEBOT_DEFAULTS.SPACE_ID,
    indexNodeToken: process.env.FEISHU_WIKI_INDEX_NODE_TOKEN || NINEBOT_DEFAULTS.INDEX_NODE_TOKEN,
    parentNodeTokens: process.env.FEISHU_WIKI_PARENT_NODE_TOKEN || NINEBOT_DEFAULTS.PARENT_NODE_TOKENS,
    webOrigin: process.env.FEISHU_WEB_ORIGIN || NINEBOT_DEFAULTS.WEB_ORIGIN,
  };
}
