# 飞书轮值提醒管理台

面向前端团队的飞书群机器人管理台。当前版本提供：

- 按周轮值：从飞书 Docx 中读取人员名单，依次计算未来主持人。
- 群内提醒：通过可配置的飞书机器人 Webhook 向指定群发送富文本消息，并 `@` 当前主持人。
- 定时派发：`/api/cron/dispatch` 每 5 分钟检查一次到期任务，避免同一任务重复发送。
- 管理页面：查看未来任务、立即发送、同步名单和调整周几/执行时间。
- 发送记录：保留每次发送的时间、消息内容、机器人 ID/名称及发送状态。
- 节假日排期：自动跳过中国法定公共假日，并支持将单次轮值手动延期到下一个可执行周。
- 节假日数据按年份长期缓存在 `data/chinese-holidays.json`；下一年度在前一年 11 月后首次进入排期查询时拉取，已缓存年份不会重复请求。数据源按每天的 `isOffDay` 判断，连续假期会完整覆盖每一天。
- 任务详情页可点击“恢复正常周期”，清除该任务此前所有手动延期记录；法定节假日跳过规则不受影响。

前端采用 Next.js + shadcn/ui。shadcn/ui 的组件源码位于 `components/ui`，可按中台规范继续扩展或覆盖样式。

## 本地启动

```bash
cp .env.example .env.local
npm install
npm run dev
```

本地需要自动派发时，另开一个终端运行 Node 定时服务：

```bash
npm run cron:local
```

Next 应用默认监听 `9595`，Node 定时服务监听 `9596`（`/health` 可检查服务状态）。定时服务默认每 5 分钟调用 `http://localhost:9595/api/cron/dispatch`，首次启动会立即检查一次。可通过 `LOCAL_CRON_URL`、`LOCAL_CRON_PORT`、`LOCAL_CRON_INTERVAL_MINUTES` 和 `CRON_SECRET` 环境变量调整地址、端口、间隔和鉴权。它与 Vercel Cron 共用同一个派发接口，因此保留 `vercel.json` 即可继续部署到 Vercel。

未填写飞书环境变量时，页面和“立即发送”可正常演示；发送操作会以本地模拟方式完成。

## 飞书应用配置

1. 创建企业自建应用，并将机器人加入目标群。
2. 申请并发布以下能力：读取 Docx 文档，以及以应用机器人身份向群聊发消息。
3. 在 `.env.local` 填入 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DOCUMENT_ID`，以及初始机器人 `FEISHU_BOT_NAME` 和 `FEISHU_BOT_WEBHOOK`。
4. 在文档/表格中按顺序维护名单，第一列为姓名，第二列为邮箱或手机号（也支持普通文档中的 `姓名 | 邮箱/手机号` 格式）。应用首次同步时会调用“通过手机号或邮箱获取用户 ID”接口查询 `open_id`，并缓存到本地 `data/feishu-user-cache.json`。

   使用该能力前，需要为应用申请 `contact:user.id:readonly` 权限。接口请求参数使用 `user_id_type=open_id`，返回的 `user_id` 即为消息 @ 所需的 `open_id`。若使用企业邮箱，需要额外申请 `contact:contact.base:readonly`，用于从通讯录用户列表中匹配 `open_id`。

`open_id` 用来确保消息真正 @ 到成员；只有显示名时，飞书不会把纯文本 `@姓名` 识别为提醒。

## 部署与持久化

`vercel.json` 已配置每 5 分钟调用一次派发接口。部署到其他平台时，用等价的定时器调用 `GET /api/cron/dispatch`，并带上 `Authorization: Bearer <CRON_SECRET>`。

当前内存存储位于 `lib/schedule-store.ts`，只用于原型演示。机器人配置页面支持新增、编辑、停用和删除（Webhook 仅展示脱敏值）。投产前应将机器人配置、任务、轮值游标和发送记录写入数据库，并加密保存 Webhook；无状态函数实例间不会共享内存。

## 飞书文档 MCP HTTP Server

本项目提供基于 MCP (Model Context Protocol) 标准协议的飞书文档读写 HTTP 服务，供大模型、IDE 或 MCP 客户端直接调用。

### 1. 启动服务

```bash
npm run mcp:server
```

- 默认监听端口：`9798`（可通过环境变量 `FEISHU_MCP_PORT` 调整，例如 `FEISHU_MCP_PORT=9799 npm run mcp:server`）
- SSE 通道端点：`http://127.0.0.1:9798/sse`
- 消息交互端点：`http://127.0.0.1:9798/messages`
- 服务健康检查：`http://127.0.0.1:9798/health`

### 2. 支持的 MCP 工具列表

| 工具名称 | 功能说明 | 核心入参 |
| :--- | :--- | :--- |
| `feishu_read_document` | 读取飞书云文档 (Docx)、知识库 (Wiki) 或表格内容，并格式化为标准 Markdown | `document_id_or_url`, `format` (默认 markdown) |
| `feishu_create_document` | 在飞书中创建新云文档 (Docx)，可指定标题、文件夹及初始 Markdown 内容 | `title`, `folder_token` (可选), `content` (可选) |
| `feishu_append_document` | 向已有飞书云文档末尾追加 Markdown 格式内容（自动转换为飞书 Blocks） | `document_id_or_url`, `content` |
| `feishu_update_document` | 全量更新/覆盖已有飞书文档正文（清空旧正文并写入全新 Markdown，支持同时修改标题） | `document_id_or_url`, `content`, `title` (可选) |
| `feishu_patch_block` | 局部更新/修改已有飞书文档中的指定块 (Block) 文本内容 | `document_id_or_url`, `block_id`, `content` |
| `feishu_get_document_info` | 查询飞书文档/表格的元信息（标题、类型、版本与访问链接） | `document_id_or_url` |

### 3. MCP 客户端接入配置示例

#### Antigravity / Cursor / Claude 等 MCP HTTP Client (`mcp_config.json`)

```json
{
  "mcpServers": {
    "feishu-document": {
      "type": "sse",
      "url": "http://127.0.0.1:9798/sse"
    }
  }
}
```

> **权限说明**：
> - 读取文档需在飞书开发者后台开通 `docx:document:readonly` 与 `wiki:wiki:readonly`。
> - 创建和写入文档需申请开通 `docx:document` 与 `wiki:wiki`。
> - 若操作个人空间或团队空间私有文档，请先在飞书文档右上角「分享/协同」中将自建应用添加为协作者。

