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
