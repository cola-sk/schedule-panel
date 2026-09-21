# Confluence 文档自动归档到飞书知识库：方案草案

## 结论

方案可行，且当前项目已有飞书 SDK 与文档 Markdown 转换能力，可以复用。建议把它做成一个**异步、可审核、可增量**的“知识库归档”入口，而不是在浏览器请求内一次性完成迁移。

默认策略应为「先分类预览，人工批准后发布」。只有完成一轮人工抽检且模型结果稳定后，才允许对高置信度文档自动发布。

## 目标与范围

输入为 Confluence 目录根页面：`pageId=88434409` 及其所有后代页面；输出为飞书知识库根节点：`SFHOwfaJ8iC6Vzkm8ehcL5YYn2f` 下已经创建好的分类目录。

首期能力：

- 递归扫描指定 Confluence 目录下的页面，读取标题、层级、版本、更新时间和正文。
- 调用用户配置的 OpenAI 兼容 LLM，对每篇页面判定一级类与二级类。
- 将分类结果展示为待审核清单；支持改分类、排除和批量批准。
- 在对应飞书目录创建 Wiki Docx，并写入清洗后的正文与来源链接。
- 保存来源页面与目标 Wiki 节点的映射，按 Confluence 版本号/正文哈希跳过未变更文档。

首期不做：附件二进制迁移、评论迁移、原页面 ACL 同步、Confluence 与飞书双向同步。图片和附件先保留原始链接，避免链接失效和权限被意外扩大。

## 分类契约

每篇文档只允许一个一级类与一个二级类；无法准确归类时进入审核队列，系统不自行创建“其它”目录。

| 一级类 | 可选二级类 |
| --- | --- |
| 规范与标准 | 代码规范、研发流程、团队制度、安全合规规范 |
| 方案与架构 | 技术选型、架构设计、业务技术方案、性能优化方案 |
| 基础库与能力 | SDK、UI 组件库、通用工具库、Hook 库 |
| 工程与效能 | 脚手架和模版、本地开发和调试、质量与测试、CI/CD 与部署、构建与编译 |
| 监控和运维 | 数据指标定义、监控和告警、故障排查手册、应急与容灾 |
| 知识与成长 | 技术复盘、技术调研、技术分享、新人文档 |
| AI 研发资产 | Prompt 和 Skill、MCP、Agent 工具 |

LLM 必须返回受校验的 JSON：

```json
{
  "primaryCategory": "工程与效能",
  "secondaryCategory": "CI/CD 与部署",
  "confidence": 0.91,
  "reason": "描述了发布流水线、环境和回滚步骤",
  "summary": "不超过 120 字的摘要"
}
```

后端只接受上述分类白名单；JSON 解析失败、标签不在白名单中，或 `confidence < 0.85` 的结果一律进入审核。提示词只提供标题、原路径、正文清洗后的文本和这份分类表，避免模型自由发挥目录名称。

## 推荐流程

```text
配置来源与模型 → 创建归档任务 → 扫描/提取 → 去重与增量判断
                                      ↓
                                  LLM 分类
                                      ↓
                 高置信度 ─────→ 发布到映射目录
                                      ↓
                 低置信度/冲突 → 人工审核 → 批准后发布
```

配套流程图见 [wiki-to-feishu-knowledge-sync.drawio](./diagrams/wiki-to-feishu-knowledge-sync.drawio)；PNG 预览见 [wiki-to-feishu-knowledge-sync.png](./diagrams/wiki-to-feishu-knowledge-sync.png)。

## 外部系统接入

### Confluence

- 由服务端通过 Confluence REST API 扫描 `pageId=88434409` 的后代页面；优先使用 descendants/children 分页接口，不抓取网页 HTML。
- 每页读取 `id`、`title`、`ancestors`、`version.number`、`version.when`、`body.storage.value`。
- 凭据采用 Confluence PAT 或 OAuth access token，密文存储；任务日志中只显示脱敏后的连接地址和凭据标识。
- 遇到 401/403、分页缺失或单页读取失败时，保留失败项并允许单项重试，不让整批任务静默漏文档。

### 自定义 OpenAI 兼容 LLM

- 使用官方 `openai` Node SDK，按配置传入 `baseURL`、API key、model；不要绑定某一家模型。
- 用 Zod 做本地 Schema/白名单校验。并非所有兼容服务都支持 OpenAI 的 `response_format`，所以应同时在提示词中约束 JSON，并对返回值做容错解析和校验。
- 发送正文前进行长度控制：标题、面包屑、前若干个标题及正文片段优先；过长文档可先生成摘要再分类。模型调用不可用或超时则转审核，不自动猜测。
- 因为文档内容会送往配置的模型端点，入口必须明确展示该数据流向，并要求操作者确认该端点符合团队数据合规要求。

### 飞书知识库

- 启动任务前，通过目标根节点 `SFHOwfaJ8iC6Vzkm8ehcL5YYn2f` 获取 space 信息，并遍历其现有子节点。
- 根据目录标题建立 `一级/二级分类 → parent_node_token` 映射；缺少或重名的目录直接阻断发布并提示管理员修复，不能按名称临时新建目录。
- 在 `parent_node_token` 下创建 `docx` 类型 Wiki 节点，写入标题和正文。正文首屏加入来源 Confluence URL、来源版本与最近同步时间，便于追溯。
- 需要的应用权限至少包括 Wiki 读写和 Docx 读写；应用必须被添加为目标知识库的可编辑成员。现有项目的 Lark SDK 可以承接此部分。

## 关键数据与幂等性

需要数据库，不能继续使用当前内存 store。建议新增以下持久化实体：

| 实体 | 关键字段 | 用途 |
| --- | --- | --- |
| `knowledge_sync_config` | source root、LLM 配置引用、destination root、发布策略 | 每个归档入口的配置 |
| `knowledge_sync_job` | 状态、统计、启动人、开始/结束时间 | 一次批处理任务 |
| `knowledge_sync_item` | `source_page_id`、source version/hash、原始标题/路径、人工确认后的标题/路径、分类、置信度、状态、错误 | 每篇文档的工作项 |
| `knowledge_document_mapping` | `source_page_id`、`target_wiki_node_token`、目标分类、最后成功版本/hash | 增量判断与定位目标文档 |
| `knowledge_audit_log` | 操作人、前后分类、发布/重试结果 | 审计与问题追踪 |

以 `source_page_id` 作为来源唯一键；发布时基于映射表做“创建或更新”，写库与调用飞书 API 都带幂等处理。源版本和正文哈希都未改变时直接跳过。

为避免覆盖飞书侧人工修改，MVP 建议**只自动创建新文档**；已经迁移的文档发生源端更新时，生成“待更新”审核项，由审核人确认后再覆盖正文。稳定运行后，才能增加可配置的自动覆盖策略。

### 文档状态、筛选与审计

迁移状态必须落库，不以任务运行日志代替。每一篇来源文档从扫描到发布都保存为独立工作项，建议状态如下：

| 状态 | 含义 | 可执行操作 |
| --- | --- | --- |
| `discovered` | 已从来源目录扫描到，尚未完成分类 | 重新分类、排除 |
| `pending_review` | 已有模型建议，等待人工确认标题和目标路径 | 编辑、批准、排除 |
| `approved` | 人工已确认，等待发布任务写入飞书 | 取消批准、开始迁移 |
| `migrating` | 正在创建 Wiki 文档或写入正文 | 查看进度 |
| `migrated` | 新文档已创建并写入成功 | 打开飞书文档、重新迁移副本 |
| `failed` | 扫描、分类或写入失败 | 查看错误、单项重试 |
| `skipped` | 人工明确不迁移 | 恢复到待审核 |

确认看板提供按状态、来源目录、建议/最终一级类、二级类、创建人、最后更新人、迁移确认人、任务批次、时间范围和关键字筛选；`migrated` 项应直接显示目标飞书链接，`failed` 项显示可读错误原因和最近一次重试时间。

`knowledge_sync_item` 至少保存以下信息：来源类型/页面 ID/URL、原始标题与路径、来源创建人和创建时间、来源最后更新人与更新时间、模型建议、人工最终标题和目录、确认人和确认时间、迁移状态、目标 Wiki node token/URL、失败原因、重试次数及时间戳。每一次修改标题、路径、排除、批准和重试都写入 `knowledge_audit_log`。

### 新建飞书文档的溯源信息

每篇成功迁移的飞书文档在**正文最前方**写入统一的“迁移信息”区块，再写正文；它不是页面标题的一部分，避免影响搜索和目录展示。

```text
迁移信息
来源：<Confluence 原始标题>（原文链接）
来源创建人：<source creator>｜创建时间：<source created at>
来源最后更新人：<source updater>｜更新时间：<source updated at>
迁移确认人：<平台操作人>｜确认时间：<approved at>
迁移执行时间：<migrated at>
```

其中“来源创建人/最后更新人”取自 Confluence 的 `history` 和 `version` 元数据；“迁移确认人”取平台登录用户，而不是飞书应用机器人。这样即使新文档由应用身份创建，团队也能分清原始作者、最后维护者和本次迁移的责任人。

## 平台入口与交互

新增一级入口：`知识库归档`。

1. **配置页**：Confluence 根目录、凭据、目标知识库、模型地址/API Key/模型名、发布方式（默认“全部审核”）。
2. **任务页**：新建任务、实时统计（扫描/跳过/待审核/已发布/失败）、暂停、重试失败项。
3. **审核页**：表格展示来源标题、原路径、模型分类、置信度、理由、摘要；支持逐项修改、排除、批量批准。
4. **详情/审计页**：显示来源 URL、目标 URL、源版本、同步结果与重试记录。

首批建议先跑“只扫描和分类、不发布”的 dry run；随机抽查 30–50 篇结果后再打开发布。

## 运行方式与技术建议

批量文档扫描、模型调用和飞书写入都可能超过 Next Route Handler 的执行时限，不能依赖一个同步 HTTP 请求，特别是部署在 Vercel 时。

- Web/API：保持 Next.js，负责配置、创建任务、审核和查询。
- 数据库：PostgreSQL，存储配置（密文）、任务、映射和审计。
- Worker：独立 Node 进程处理扫描/分类/发布。
- 队列：BullMQ + Redis，按文档粒度入队，配置 Confluence、LLM、飞书三侧的限速、退避和死信重试。
- 机密：API Key/Token 用 KMS 或应用层信封加密，前端只回显是否已配置，绝不回传原值。

## 分期落地

| 阶段 | 交付 | 验收条件 |
| --- | --- | --- |
| P0 可行性验证 | 用 10 篇页面完成扫描、分类、在测试目录创建文档 | 目录 Token 映射正确，正文无明显缺失，人工判定分类正确率达标 |
| P1 MVP | 新入口、配置、异步任务、审核、创建发布、任务记录 | 可以稳定处理全部目录；失败可见、可重试、重复运行不重复创建 |
| P2 增量同步 | 版本/哈希比对、变更待审核、审计与指标 | 重跑只处理新增/变更页面，不覆盖飞书人工编辑 |
| P3 自动化 | 高置信度自动发布、定时同步、告警 | 经抽样验证后才对指定分类开启，异常自动降级到审核 |

## 上线前必须确认

1. Confluence 访问方式（PAT/OAuth）以及应用账号是否能读取该目录的全部后代页面。
2. 飞书目标根目录下的七个一级目录和全部二级目录是否已经按上述名称创建，且应用拥有编辑权限。
3. 自定义模型端点的数据合规范围、最大上下文长度、请求频率和计费归属。
4. 首期是否只迁移正文与原链接；若需要图片/附件一并迁移，需要单独设计文件上传、权限和引用重写。

---

## 方案评审与实施参考建议（Review & Recommendations）

- **评审人 / 修改人**：Gemini (AI 架构助手)
- **更新时间**：2026-09-11
- **状态**：参考意见（已与业务诉求对齐）

### 1. 内网 Confluence 访问与认证机制落地细化

由于目标 Wiki (`https://wiki.segwayrobotics.com`) 为企业内网环境且需要认证登录，在技术实施上需明确以下两点：

1. **部署网络通达性**：
   - 平台的后端服务或 Worker **必须部署在可访问公司内网的环境中**（如公司内部服务器、私有容器集群），或在公网服务中配置通往公司内网的 HTTP/SOCKS 代理通道。若部署在纯公网平台（如 Vercel），将无法直连内网域名。
2. **认证方式多模式兼容**：
   Confluence Server / Data Center 企业内部部署形态多样，配置面板应提供以下 3 种主流认证方式供用户选择：
   - **Personal Access Token (PAT)**（首选推荐）：在 Confluence 个人中心生成，请求头携带 `Authorization: Bearer <token>`，免去明文密码泄露风险且长期稳定。
   - **Basic Auth（账号 + 密码）**：请求头携带 `Authorization: Basic <base64(username:password)>`。
   - **Session Cookie**：针对公司开启了强制单点登录（SSO）且未开通 PAT 的情况，支持填入浏览器登录后的 Cookie（如 `JSESSIONID`、`crowd.token_key` 等），通过携带 Cookie 请求 REST API。

### 2. 文档头部溯源元数据提取与飞书富文本渲染规范

关于“从 Wiki copy 内容并在飞书新建文档，文首维护原作者创作人、最后更新人及时间”的落地规范：

1. **Confluence API 元数据取数参数**：
   - 请求 Confluence API 时，必须显式附加参数：`?expand=history,history.lastUpdated,version,body.storage`。
   - **原作者与创建时间**：读取 `history.createdBy.displayName`（或 `username`）以及 `history.createdDate`。
   - **最后更新人与修改时间**：读取 `version.by.displayName` 以及 `version.when`。
2. **飞书端渲染为原生「高亮提示面板 / 引用块 (Callout / Quote Block)」**：
   - 在将 Markdown 转换为飞书 Docx 块时，文首信息应避免渲染为普通扁平文本，建议生成为飞书原生的 Callout/Quote 高亮容器块，与正文内容形成清晰边界。
   - **格式示例**：
     > 📌 **文档迁移溯源信息**
     > - **来源文档**：[<Confluence 原标题>](https://wiki.segwayrobotics.com/pages/viewpage.action?pageId=88434409)
     > - **原作者**：张三 ｜ **创建时间**：2023-05-12 14:30:00
     > - **最后更新人**：李四 ｜ **更新时间**：2024-08-20 10:15:00

### 3. Confluence 特有宏（Macros）清洗中间件

Confluence 的正文是 XHTML 存储格式（`body.storage.value`），其中包含大量 Confluence 专有宏标签：
- 代码块宏：`<ac:structured-macro ac:name="code">...<ac:plain-text-body><![CDATA[...]]></ac:plain-text-body></ac:structured-macro>`
- 提示宏（Info / Warning / Note）：`<ac:structured-macro ac:name="info">...`
- 折叠面板宏：`<ac:structured-macro ac:name="expand">...`
- 目录宏（TOC）与状态标签（Status）宏。

**实施建议**：在 XHTML 转换为 Markdown 或飞书 Blocks 之前，实现一个轻量级预处理清洗管道（基于 Cheerio 或正则），将上述 Confluence 专有宏平滑映射为标准的 Markdown 语法（如转化为 Markdown Fenced Code Blocks、Blockquotes 等），杜绝飞书文档中残留无意义的 XML 标签。

### 4. 飞书知识库节点创建与正文写入两步走

飞书开放平台 Wiki API 不支持在单个接口同时完成“挂载节点”与“写入完整富文本 Blocks”，标准调用流需分为两步：
1. **创建知识库文档节点**：
   调用 `POST /open-apis/wiki/v2/spaces/{space_id}/nodes`，传入对应二级分类的 `parent_node_token`，`obj_type` 设为 `docx`，获取返回的新节点 `node_token` 与底层的 `obj_token`（即 docx token）。
2. **正文写入**：
   复用当前项目已封装成熟的 `lib/mcp/feishu-doc-engine.ts`，向该 `obj_token` 写入拼接好溯源信息的 Markdown 内容。

### 5. 架构分期落地建议：优先轻量 MVP 快速上线

原方案设计的 `PostgreSQL + BullMQ + Redis + 独立 Worker` 属于企业级超大规模异步架构，若当前目标主要是满足研发团队当前目录（几十至数百篇文档）的迁移需求，建议采用渐进式路线：
- **MVP 阶段（敏捷上线）**：
  - **存储**：复用项目现有的本地持久化层（JSON / SQLite），免除部署独立数据库的门槛；
  - **调度与限频**：在 Node.js 服务内使用轻量级异步并发控制（如 `p-limit` 控制并发 3~5 个），内置退避重试，防止触发飞书与 LLM API 的 QPS 限额；
  - 该方案可在数天内完成端到端闭环并投入使用。
- **演进阶段**：
  - 若后续推广至全公司级海量文档常态化定时同步，再按原方案无缝接入 Redis + BullMQ 独立 Worker。

