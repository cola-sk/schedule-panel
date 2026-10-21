import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

export interface TelemetryEnvironment {
  clientType: string;
  projectName?: string;
  gitRepo?: string;
  gitBranch?: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  mcpVersion: string;
}

export interface TelemetrySearchSummary {
  title: string;
  url: string;
  token?: string;
  source?: string;
}

export interface TelemetryEvent {
  eventId: string;
  timestamp: string;
  durationMs: number;
  toolName: string;
  success: boolean;
  errorMessage?: string;
  environment: TelemetryEnvironment;
  query?: string;
  hasIndexed?: boolean;
  resultCount?: number;
  resultsSummary?: TelemetrySearchSummary[];
  searchSource?: string;
  metadata?: Record<string, unknown>;
}

// 绑定的 MCP Server 实例（用于向客户端请求 roots/list 与 clientVersion）
let activeServerInstance: any = null;

// 缓存环境探测结果
let cachedEnv: TelemetryEnvironment | null = null;

/**
 * 重置环境信息缓存（主要供单测使用）
 */
export function resetTelemetryCacheForTest(): void {
  cachedEnv = null;
  activeServerInstance = null;
}

/**
 * 绑定当前运行的 MCP Server 实例
 */
export function bindTelemetryServer(server: any): void {
  activeServerInstance = server;
}

/**
 * 尝试安全读取 Git 仓库信息（纯文件读取，零子进程开销）
 */
export function resolveGitInfo(targetDir: string): { gitRepo?: string; gitBranch?: string } {
  try {
    let currentDir = targetDir;
    for (let i = 0; i < 5; i++) {
      const gitDir = path.join(currentDir, ".git");
      if (fs.existsSync(gitDir)) {
        let gitBranch: string | undefined;
        let gitRepo: string | undefined;

        // 1. 读取 HEAD 获取分支
        const headPath = path.join(gitDir, "HEAD");
        if (fs.existsSync(headPath)) {
          const headContent = fs.readFileSync(headPath, "utf-8").trim();
          const match = headContent.match(/^ref: refs\/heads\/(.+)$/);
          if (match) {
            gitBranch = match[1];
          }
        }

        // 2. 读取 config 中的 remote origin url
        const configPath = path.join(gitDir, "config");
        if (fs.existsSync(configPath)) {
          const configContent = fs.readFileSync(configPath, "utf-8");
          const originMatch = configContent.match(/\[remote ["']origin["']\][^\[]*?url\s*=\s*(.+)/);
          if (originMatch && originMatch[1]) {
            const rawUrl = originMatch[1].trim();
            // 提取 repo path，如 git@xxx:team/repo.git -> team/repo 或 https://xxx/team/repo.git -> team/repo
            const repoPath = rawUrl
              .replace(/\.git$/, "")
              .split(/[:/]/)
              .slice(-2)
              .join("/");
            if (repoPath) {
              gitRepo = repoPath;
            }
          }
        }

        return { gitRepo, gitBranch };
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
  } catch {
    // 忽略异常，确保不影响核心功能
  }
  return {};
}

/**
 * 探测宿主客户端类型
 */
export function detectClientType(): string {
  // 1. 优先尝试从 MCP 握手协议中直接获取真实客户端信息（最权威）
  try {
    const rawServer = activeServerInstance?.server || activeServerInstance;
    if (rawServer && typeof rawServer.getClientVersion === "function") {
      const clientVersion = rawServer.getClientVersion();
      if (clientVersion?.name) {
        return clientVersion.version
          ? `${clientVersion.name.toLowerCase()}/${clientVersion.version}`
          : clientVersion.name.toLowerCase();
      }
    }
  } catch {
    // ignore
  }

  // 2. 回退到常见宿主特征探测
  const env = process.env;
  if (env.CURSOR_AGENT || env.CURSOR_USER_ID) {
    return "cursor";
  }
  if (env.ANTIGRAVITY || env.ANTIGRAVITY_AGENT) {
    return "antigravity";
  }
  if (env.CLAUDE_DESKTOP || env.CLAUDE_CODE) {
    return "claude-desktop";
  }
  if (env.VSCODE_PID || env.VSCODE_INJECTION) {
    return "vscode";
  }
  return "unknown";
}

/**
 * 严格通过 MCP 原生协议向客户端请求 roots/list 解析工程工作区
 * 若客户端未提供 roots，则返回 null，不进行 cwd 或环境变量猜测
 */
export async function resolveProjectDir(): Promise<string | null> {
  try {
    const rawServer = activeServerInstance?.server || activeServerInstance;
    if (rawServer && typeof rawServer.listRoots === "function") {
      // 设置 800ms 快速超时，避免客户端无响应挂起
      const rootsResult = await Promise.race([
        rawServer.listRoots(),
        new Promise<null>((r) => setTimeout(() => r(null), 800)),
      ]);

      if (rootsResult && Array.isArray(rootsResult.roots) && rootsResult.roots.length > 0) {
        const primaryRoot = rootsResult.roots[0];
        if (primaryRoot.uri && primaryRoot.uri.startsWith("file://")) {
          const rootPath = fileURLToPath(primaryRoot.uri);
          if (fs.existsSync(rootPath)) {
            return rootPath;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * 获取当前运行环境信息
 */
export async function getEnvironmentInfoAsync(): Promise<TelemetryEnvironment> {
  if (cachedEnv && cachedEnv.projectName && cachedEnv.projectName !== "unknown") {
    return cachedEnv;
  }

  const projectDir = await resolveProjectDir();
  let projectName = "unknown";
  let gitRepo: string | undefined;
  let gitBranch: string | undefined;

  if (projectDir) {
    projectName = path.basename(projectDir);
    const gitInfo = resolveGitInfo(projectDir);
    gitRepo = gitInfo.gitRepo;
    gitBranch = gitInfo.gitBranch;
  }

  // 从本地 package.json 获取版本号
  let mcpVersion = "1.0.4";
  try {
    const pkgPath = path.resolve(__dirname, "../package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      mcpVersion = pkg.version || mcpVersion;
    }
  } catch {
    // ignore
  }

  cachedEnv = {
    clientType: detectClientType(),
    projectName,
    gitRepo,
    gitBranch,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    mcpVersion,
  };

  return cachedEnv;
}

/**
 * 同步获取基础环境信息（项目信息默认为 unknown，待异步 roots/list 注入）
 */
export function getEnvironmentInfoSync(): TelemetryEnvironment {
  if (cachedEnv) return cachedEnv;

  let mcpVersion = "1.0.4";
  try {
    const pkgPath = path.resolve(__dirname, "../package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      mcpVersion = pkg.version || mcpVersion;
    }
  } catch {
    // ignore
  }

  cachedEnv = {
    clientType: detectClientType(),
    projectName: "unknown",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    mcpVersion,
  };

  return cachedEnv;
}

/**
 * 获取上报服务地址
 */
export function getTelemetryEndpoint(): string | null {
  if (
    process.env.NINEBOT_TELEMETRY_DISABLED === "true" ||
    process.env.FEISHU_MCP_TELEMETRY_DISABLED === "true"
  ) {
    return null;
  }

  const endpoint =
    process.env.NINEBOT_TELEMETRY_ENDPOINT ||
    process.env.FEISHU_MCP_TELEMETRY_ENDPOINT;

  if (!endpoint) return null;

  return endpoint.endsWith("/api/v1/report") || endpoint.endsWith("/api/report")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/api/v1/report`;
}

/**
 * 异步、非阻塞、Fire-and-Forget 上报
 */
export function reportTelemetry(
  data: Omit<TelemetryEvent, "eventId" | "timestamp" | "environment">
): void {
  const endpoint = getTelemetryEndpoint();
  if (!endpoint) return;

  // 异步获取完整的项目信息后上报，彻底解耦主执行耗时
  void (async () => {
    try {
      const environment = await getEnvironmentInfoAsync().catch(() => getEnvironmentInfoSync());
      const payload: TelemetryEvent = {
        eventId: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        environment,
        ...data,
      };

      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 2000) : null;

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller?.signal,
      })
        .then(() => {
          if (timer) clearTimeout(timer);
        })
        .catch(() => {
          if (timer) clearTimeout(timer);
        });
    } catch {
      // 静默丢弃
    }
  })();
}
