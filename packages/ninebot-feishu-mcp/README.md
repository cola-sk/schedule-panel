# @ninebot/feishu-mcp

> 九号前端团队飞书知识库与工程规范 MCP (Model Context Protocol) 服务。  
> 为 **Cursor、VS Code (Cline / Roo Code)、Trae、Windsurf、Antigravity** 等各类 AI 编程客户端提供开箱即用的前端规范索引、知识库检索与文档读写能力。

---

## 📖 目录
- [🌟 核心用途与特色](#-核心用途与特色)
- [🚀 接入配置指南](#-接入配置指南)
  - [1. Cursor / VS Code (Stdio 本地执行，最推荐)](#1-cursor--vs-code-stdio-本地执行最推荐)
  - [2. 远程集中部署 (团队统一托管，全员免配置密钥)](#2-远程集中部署-团队统一托管全员免配置密钥)
- [🛠️ 工具列表 (Tools)](#️-工具列表-tools)
- [💬 常见使用示例 (Prompts)](#-常见使用示例-prompts)
- [⚙️ 环境变量说明](#️-环境变量说明)
- [🔎 维护检索词典 (免发版热更新)](#-维护检索词典-免发版热更新)
- [📦 本地开发与发布](#-本地开发与发布)

---

## 🌟 核心用途与特色

通过标准 MCP 协议，为 AI 编程助手注入团队知识库上下文与文档读写能力：

- 📌 **规范优先**：内置前端工程化规范导航索引（团队的 `llms.txt`），优先定位权威规范，杜绝过时讨论稿。
- 🔍 **精准检索**：专有术语动态 Trie 词典 + 中文形态学分词 + MiniSearch BM25 检索，精准识别内部专有名词。
- 📑 **清洁 Markdown**：文档 (Docx)、电子表格 (Sheet)、多维表格 (Bitable) 统一转换为易于 LLM 理解的 Markdown。
- ✍️ **读写修改**：支持在线新建技术文档、追加评审记录、全量覆盖或局部精确修改 Block。

---

## 🚀 接入配置指南

### 1. Cursor / VS Code (Stdio 本地执行，最推荐)

在客户端的 MCP 配置文件中添加配置：
- **Cursor**：`~/.cursor/mcp.json`（全局）或 项目根目录下的 `.cursor/mcp.json`（单项目）
- **VS Code (Cline / Roo Code)**：在插件设置中的 `MCP Servers` 配置中添加
- **Windsurf / Trae**：在对应的 `mcp_config.json` 中添加

#### 推荐写法：使用 `--registry` 指定九号内网私服

```json
{
  "mcpServers": {
    "ninebot-feishu": {
      "command": "npx",
      "args": [
        "--registry=https://npm.ninebot.com/",
        "-y",
        "@ninebot/feishu-mcp"
      ],
      "env": {
        "FEISHU_APP_ID": "cli_xxxxxxxxxxxxxxxx",
        "FEISHU_APP_SECRET": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

#### 备选写法：通过 `npm_config_registry` 环境变量注入

```json
{
  "mcpServers": {
    "ninebot-feishu": {
      "command": "npx",
      "args": [
        "-y",
        "@ninebot/feishu-mcp"
      ],
      "env": {
        "npm_config_registry": "https://npm.ninebot.com/",
        "FEISHU_APP_ID": "cli_xxxxxxxxxxxxxxxx",
        "FEISHU_APP_SECRET": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

> **提示**：团队知识库空间 ID 与权威索引 Token 已经在包内默认内置，只需配置你的飞书应用 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 即可。

---

### 2. 远程集中部署 (团队统一托管，全员免配置密钥)

如果不希望每位团队成员都在本机配置飞书 AppSecret，可以在内网服务器集中部署一次：

```bash
# 启动 HTTP/SSE 远程服务
FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx npx --registry=https://npm.ninebot.com/ @ninebot/feishu-mcp-server
```

团队全员在各 IDE 的 `mcp.json` 中配置远程 URL 直连即可：

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

## 🛠️ 工具列表 (Tools)

服务启动后会自动注册以下 9 个标准化 MCP 工具：

| 工具名称 | 功能描述 | 典型场景 |
| :--- | :--- | :--- |
| `feishu_get_team_index` | 读取团队权威导航索引全文 | 了解工程规范全景、定位权威规范入口 |
| `feishu_search_wiki` | 检索飞书知识库文档 | 按技术关键词在知识库（限定目录下）搜索相关文档 |
| `feishu_read_document` | 将文档/表格解析为 Markdown 全文 | 阅读具体的设计稿、SDK 接入文档或接口定义 |
| `feishu_get_document_info` | 获取文档基础元信息（标题、类型、创建时间等） | 快速获取文档类型与基础属性 |
| `feishu_create_document` | 在指定知识库节点或文件夹下新建文档 | AI 自动生成技术设计方案、规范草稿并归档 |
| `feishu_append_document` | 向已有文档末尾追加 Markdown 内容 | 追加会议纪要、评审意见或更新日志 |
| `feishu_update_document` | 全量覆盖更新文档或多维表格数据 | 刷新整篇文档内容或同步批量表格数据 |
| `feishu_patch_block` | 精确修改文档中的某个 Block 块 | 局部调整某些段落、表格单元格或代码块 |
| `feishu_list_wiki_spaces` | 列出当前机器人有权访问的所有知识库空间 | 确认空间 ID 与权限范围 |

---

## 💬 常见使用示例 (Prompts)

配置完成后，可以在 AI 对话框中直接像与搭档交流一样提问，AI 会自动调用相应工具：

### 示例 1：查询团队技术接入规范
> **Prompt**：“我们团队微前端子应用接入的规范是什么？有哪些必传参数和生命周期钩子？”  
> **底层动作**：AI 调用 `feishu_get_team_index` 定位微前端规范，接着调用 `feishu_read_document` 查阅《微前端 Suite SDK 接入和使用》，准确给出规范说明。

### 示例 2：查询指标与口径定义
> **Prompt**：“查一下微前端指标口径的定义和统计方式，有哪些核心监控指标？”  
> **底层动作**：AI 调用 `feishu_search_wiki("微前端指标口径")`，命中文档后自动阅读全文并提炼总结。

### 示例 3：解析飞书文档并指导代码编写
> **Prompt**：“阅读这篇文档 https://segway-ninebot.feishu.cn/wiki/xxx ，并按照文中的 Axios 封装标准改造我当前的 request.ts 文件。”  
> **底层动作**：AI 提取 URL 中的 Wiki Token，调用 `feishu_read_document` 获取文档 Markdown，然后结合你的代码库进行适配改造。

### 示例 4：自动输出技术方案到飞书
> **Prompt**：“基于我们刚才讨论的权限重构方案，在知识库规范目录下新建一篇《前端动态路由与权限方案设计》，正文包含架构图与关键流程。”  
> **底层动作**：AI 调用 `feishu_create_document` 在目标目录下直接生成格式规范的飞书云文档。

---

## ⚙️ 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `FEISHU_APP_ID` | **是** | - | 飞书自建应用 App ID |
| `FEISHU_APP_SECRET` | **是** | - | 飞书自建应用 App Secret |
| `FEISHU_WIKI_SPACE_ID` | 否 | `7680762028796972249` | 前端研发部知识库空间 ID |
| `FEISHU_WIKI_INDEX_NODE_TOKEN` | 否 | `HET8wUwdgivtMtkp7QocSD9pn2e` | 《前端工程化规范与能力导航索引》Wiki Token |
| `FEISHU_WIKI_PARENT_NODE_TOKEN` | 否 | 见下文说明 | 限制检索的目录白名单（逗号分隔） |
| `FEISHU_MCP_PORT` | 否 | `9798` | HTTP 服务监听端口 |

> **默认限制检索父目录**：
> 1. `AZ5awBTNviWQvEkFIkIcjsYJnae`：规范与标准（代码规范、Git 工作流、门禁接入等）
> 2. `Q9BlwNIfaiUhP5kyOvbc5RSxndc`：基础库与通用能力（公共 SDK、脚手架、组件库等）
> 3. `IJtpwQHPiirZaNksdjicOlnxnnb`：监控和运维（数据指标口径、性能监控、埋点规范等）

---

## 🔎 维护检索词典 (免发版热更新)

团队术语、英文缩写及同义词**不需要修改代码或发布 npm 新版本**。只需在飞书的《前端工程化规范与能力导航索引》表格中增加一列 **`关键词`**、**`检索词`** 或 **`别名`**：

| 文档 | 关键词 / 别名 |
| :--- | :--- |
| 微前端接入规范 | qiankun、子应用、主应用、MicroSuite |
| 组件库规范 | ui库、ti-components |
| 数据埋点与监控 | apm、观测云、指标口径 |

MCP 服务具有自动缓存刷新机制（默认最长 10 分钟）：
* 每次刷新时，引擎会自动提取该列，动态构建 Trie 树和同义词映射表；
* 搜索时自动识别别名与缩写并归一化到官方文档。

---

## 📦 本地开发与发布

```bash
# 1. 安装依赖
npm install

# 2. 运行自动化测试（覆盖 Trie、形态学切分与 MiniSearch 排序）
npm test

# 3. 编译打包生成 dist
npm run build

# 4. 本地以 Stdio 模式启动调试
npm run dev

# 5. 本地以 HTTP 模式启动调试
npm run dev:server

# 6. 发布到九号内部私服
npm publish --registry=https://npm.ninebot.com/
```

---

## 📄 授权协议

[MIT License](LICENSE) © Ninebot Frontend Team
