# @ninebot/feishu-mcp

> 九号前端团队飞书知识库与工程规范 MCP (Model Context Protocol) 服务。
> 为 Cursor、VSCode、Trae、Antigravity 等各类 AI 编程客户端提供开箱即用的前端规范索引、知识库检索与文档读写能力。

---

## 🌟 核心能力

- 📌 **团队权威索引直读 (`feishu_get_team_index`)**：直接获取九号前端工程化规范导航索引（类似 `llms.txt`），让大模型一次性掌握规范全景。
- ⭐ **规范优先精准搜索 (`feishu_search_wiki`)**：结合技术词正则、停用词与原生中文分词，优先置顶团队权威规范推荐，支持限定目录检索与多词加权打分。
- 📖 **全类型文档解析 (`feishu_read_document`)**：将飞书云文档（Docx）、电子表格（Sheet）、多维表格（Bitable）解析为高质量 Markdown。
- ✍️ **云文档管理**：支持创建文档、追加内容、全量替换和局部 Block 精确修改。

---

## 🚀 接入方式

### 方式 1：Cursor / VSCode (Stdio 本地执行，最简单)

在 Cursor 的 `~/.cursor/mcp.json` 或项目根目录下的 `.cursor/mcp.json` 中添加配置：

```json
{
  "mcpServers": {
    "ninebot-feishu": {
      "command": "npx",
      "args": ["-y", "@ninebot/feishu-mcp"],
      "env": {
        "FEISHU_APP_ID": "cli_xxxxxxxx",
        "FEISHU_APP_SECRET": "xxxxxxxxxxxx"
      }
    }
  }
}
```

> **提示**：团队的知识库空间 ID（前端研发部）与规范索引 Token 已在包内作为默认常量内置，**无需手动配置** `FEISHU_WIKI_SPACE_ID` 等参数。

---

### 方式 2：远程集中部署 (团队统一托管，全员免密钥)

由团队内网服务器部署一次，所有开发者零配置直连：

```bash
# 启动 HTTP/SSE 远程服务
FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx npx @ninebot/feishu-mcp-server
```

开发者只需在各自 IDE 的 `mcp.json` 中配置远程 URL：

```json
{
  "mcpServers": {
    "ninebot-feishu": {
      "url": "http://fe-mcp.ninebot.internal:9798/mcp"
    }
  }
}
```

---

## ⚙️ 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `FEISHU_APP_ID` | **是** | - | 飞书自建应用 App ID |
| `FEISHU_APP_SECRET` | **是** | - | 飞书自建应用 App Secret |
| `FEISHU_WIKI_SPACE_ID` | 否 | `7680762028796972249` | 九号前端研发部知识库空间 ID |
| `FEISHU_WIKI_INDEX_NODE_TOKEN` | 否 | `HET8wUwdgivtMtkp7QocSD9pn2e` | 《前端工程化规范与能力导航索引》Wiki Token |
| `FEISHU_WIKI_PARENT_NODE_TOKEN` | 否 | `AZ5awBTNviWQvEkFIkIcjsYJnae,Q9BlwNIfaiUhP5kyOvbc5RSxndc` | 限制检索的父目录（规范与标准 + 基础库与通用能力） |
| `FEISHU_MCP_PORT` | 否 | `9798` | HTTP 服务监听端口 |

---

## 🛠️ 本地开发与发布

```bash
# 1. 安装依赖
npm install

# 2. 编译打包
npm run build

# 3. 本地调试 Stdio 模式
npm run dev

# 4. 本地调试 HTTP 服务模式
npm run dev:server

# 5. 发布到 npm
npm publish --access public
```
