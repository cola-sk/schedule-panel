# @ninebot/telemetry-collector

九号前端团队 MCP 监控数据收集与分析上报服务 (Telemetry Collector Service)。

用于接收并记录 MCP（如飞书知识库 MCP、工程规范 MCP）的调用指标，包括客户端环境信息、检索词、索引命中情况、召回结果摘要及响应状态。

---

## 🌟 核心特性

- **多环境支持**：一键部署到 **Vercel**（Serverless / Edge），或作为独立容器/Node.js 部署到自建云、阿里云、K8s 等。
- **超轻量与极速冷启动**：基于 Hono 构建，原生 Web 标准，边缘毫秒级响应。
- **全链路指标采集**：
  - 客户端环境（项目名称、Git 仓库、分支、OS、Node 版本、宿主 Cursor/Claude 等）。
  - 检索分析（搜索词、是否命中权威索引 `hasIndexed`、结果摘要、耗时）。
  - 执行健康度（成功/失败状态、错误信息）。
- **结构化日志输出**：原生支持 Vercel Log Drain / Datadog / CloudWatch / Axiom 等日志系统。
- **聚合统计接口**：内置轻量聚合 API，随时查看检索命中率与高频搜索词。

---

## 🚀 接口规范

### 1. 健康检查
- **GET** `/health` 或 `/`
- 返回：`{ "status": "ok" }`

### 2. 接收监控上报
- **POST** `/api/v1/report` (兼容 `/api/report`)
- **Headers**: `Content-Type: application/json`
- **Body**: 单个事件对象或数组：
```json
{
  "eventId": "evt_12345678",
  "timestamp": "2026-10-21T12:00:00.000Z",
  "durationMs": 142,
  "toolName": "feishu_search_wiki",
  "success": true,
  "environment": {
    "clientType": "cursor",
    "projectName": "ninebot-mall-web",
    "gitRepo": "frontend/ninebot-mall-web",
    "gitBranch": "main",
    "platform": "darwin",
    "nodeVersion": "v22.2.0",
    "mcpVersion": "1.0.4"
  },
  "query": "登录鉴权 SDK 规范",
  "hasIndexed": true,
  "resultCount": 3,
  "resultsSummary": [
    {
      "title": "⭐ [团队索引推荐] 前端统一登录接入指南",
      "url": "https://ninebot.feishu.cn/wiki/xxx",
      "token": "wikicnxxx",
      "source": "team_index"
    }
  ],
  "searchSource": "team_index+official"
}
```

### 3. 查看聚合概览
- **GET** `/api/v1/stats`
- 返回当前服务收集的请求数、索引命中率、Top 搜索词、Top 项目列表等。
- 可选环境变量 `TELEMETRY_STATS_TOKEN` 用于配置 Token 保护。

---

## 🗄️ Supabase 持久化配置

收集服务支持将每次上报的原始数据自动异步持久化到 Supabase 数据表 `mcp_telemetry_logs` 中（基于 Supabase 标准 REST API，零多余依赖）。

### 1. 在 Supabase 创建数据表
在 Supabase 的 **SQL Editor** 中运行以下建表语句：
```sql
CREATE TABLE IF NOT EXISTS public.mcp_telemetry_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tool_name VARCHAR(64) NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    client_type VARCHAR(64),
    project_name VARCHAR(128),
    git_repo VARCHAR(255),
    git_branch VARCHAR(128),
    platform VARCHAR(32),
    node_version VARCHAR(32),
    mcp_version VARCHAR(32),
    query TEXT,
    has_indexed BOOLEAN,
    result_count INTEGER DEFAULT 0,
    search_source VARCHAR(64),
    results_summary JSONB,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_mcp_logs_created_at ON public.mcp_telemetry_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_logs_tool_name ON public.mcp_telemetry_logs (tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_logs_query ON public.mcp_telemetry_logs (query) WHERE query IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_logs_has_indexed ON public.mcp_telemetry_logs (has_indexed) WHERE has_indexed IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcp_logs_project_name ON public.mcp_telemetry_logs (project_name);
```

### 2. 在 Vercel / 部署环境中配置环境变量
- `SUPABASE_URL`: 你的 Supabase Project URL（如 `https://xxxx.supabase.co`）
- `SUPABASE_KEY`: 你的 Supabase API Key（推荐使用 `service_role` key 或配置了 insert 策略的 `anon` key）

---

## 🛠️ 本地运行与开发

```bash
cd packages/ninebot-telemetry-collector
npm install
npm run dev      # 启动本地服务，默认运行在 http://localhost:9696
npm test         # 运行单元测试
```

---

## ☁️ 部署指南

### 方式一：部署到 Vercel (当前阶段推荐)
1. 在 Vercel 控制台创建新项目，导入本 Git 仓库。
2. 设置 **Root Directory** 为 `packages/ninebot-telemetry-collector`。
3. 框架预设选择 **Other**（自动识别 `vercel.json` 与 `api/index.ts`）。
4. 点击 **Deploy** 即可获得专属域名（如 `https://mcp-telemetry.vercel.app`）。

### 方式二：迁移至自建服务 / Docker (未来演进)
由于该 package 完全独立自包含，迁移时只需运行：
```bash
npm run build
PORT=8080 node dist/server.js
```
或使用基础 Node 镜像打包运行即可。
