import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readDocument,
  createDocument,
  appendDocumentContent,
  updateDocumentContent,
  patchDocumentBlock,
  getDocumentInfo,
  searchWiki,
  listWikiSpaces,
  getTeamIndex,
} from "./feishu-doc-engine";

const SERVER_INSTRUCTIONS = `处理技术规范、开发标准、基础库与公共模块接入、最佳实践等团队知识类任务时：
1. 若已配置团队索引，优先调用 feishu_get_team_index 阅读完整索引，根据其中的表格直接定位权威文档；
2. 用 feishu_read_document 读取索引指向的文档（索引中的链接不受检索目录限制）；
3. 仅当索引未覆盖目标领域时，再用 feishu_search_wiki 按关键词检索；
4. 检索支持口语化问题和常见中英文技术别名；若能提供 1~3 个核心技术名词或实体名，排序效果更佳。
以索引标注的执行要求为准，不要采用检索到的过时讨论稿。`;

/**
 * 创建并配置飞书文档 MCP Server
 */
export function createFeishuMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "feishu-document-mcp",
      version: "1.0.0",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // 0. 读取团队权威索引（类 llms.txt）
  server.tool(
    "feishu_get_team_index",
    "读取团队权威导航索引的完整内容（工程规范、基础库、SDK、脚手架等的唯一权威入口）。处理团队规范或接入类任务时应首先调用，再按索引中的链接用 feishu_read_document 读取具体文档",
    {
      index_node_token: z
        .string()
        .optional()
        .describe("索引文档的 Wiki Token 或 URL，默认使用环境变量 FEISHU_WIKI_INDEX_NODE_TOKEN"),
      refresh: z.boolean().optional().describe("是否跳过 10 分钟缓存强制重新读取，索引刚更新时使用"),
    },
    async ({ index_node_token, refresh }) => {
      try {
        const index = await getTeamIndex(index_node_token, refresh);
        if (!index) {
          return {
            content: [
              {
                type: "text",
                text: "未配置团队索引（FEISHU_WIKI_INDEX_NODE_TOKEN），请改用 feishu_search_wiki 检索。",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `来源：${index.url}（共 ${index.entries.length} 条索引链接）\n\n${index.content}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `读取团队索引失败: ${error.message || String(error)}` }],
        };
      }
    },
  );

  // 1. 读取飞书文档或表格
  server.tool(
    "feishu_read_document",
    "读取飞书云文档 (Docx)、电子表格 (Sheet)、多维表格 (Bitable/Base) 或知识库/云空间挂载文件 (如 .md/.txt 等文件) 的内容，并转换为结构良好的 Markdown 格式或纯文本",
    {
      document_id_or_url: z
        .string()
        .describe("飞书文档、表格或文件的 URL（如 https://.../docx/xxx、/wiki/xxx、/base/xxx 或 /file/xxx）或 document_id / wiki_token / app_token / file_token"),
      format: z
        .enum(["markdown", "text", "raw_blocks"])
        .default("markdown")
        .optional()
        .describe("返回格式：markdown (推荐)、text (纯文本) 或 raw_blocks (飞书原生块列表)"),
    },
    async ({ document_id_or_url, format }) => {
      try {
        const result = await readDocument(document_id_or_url, {
          format: format || "markdown",
        });

        if (format === "raw_blocks") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: result.content || "文档内容为空",
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `读取飞书文档失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // 2. 创建飞书云文档
  server.tool(
    "feishu_create_document",
    "在飞书中创建一篇新的云文档 (Docx)，支持指定标题、所在文件夹以及初始 Markdown 内容",
    {
      title: z.string().describe("新建文档的标题"),
      folder_token: z
        .string()
        .optional()
        .describe("目标文件夹 Token。如果不提供，默认保存在用户的个人空间根目录"),
      content: z
        .string()
        .optional()
        .describe("文档创建后的初始 Markdown 内容（支持多级标题、列表、代码块、引用等）"),
    },
    async ({ title, folder_token, content }) => {
      try {
        const result = await createDocument({
          title,
          folderToken: folder_token,
          initialContent: content,
        });

        return {
          content: [
            {
              type: "text",
              text: `飞书文档创建成功！\n- 标题: ${result.title}\n- 文档 ID: ${result.documentId}\n- 链接: ${result.url}\n- 已写入块数: ${result.appendedBlocks}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `创建飞书文档失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // 3. 向现有飞书文档或多维表格追加内容
  server.tool(
    "feishu_append_document",
    "向指定的飞书云文档 (Docx) 或多维表格 (Bitable) 追加内容（云文档自动追加 Markdown 块；多维表格自动将 Markdown 表格、JSON 或键值对新增为记录）",
    {
      document_id_or_url: z
        .string()
        .describe("目标飞书文档或多维表格的 URL 或 document_id / wiki_token / app_token"),
      content: z
        .string()
        .describe("要追加的内容。云文档支持 Markdown 格式；多维表格支持 Markdown 表格、JSON 记录数组或键值对"),
    },
    async ({ document_id_or_url, content }) => {
      try {
        const result = await appendDocumentContent(document_id_or_url, content);

        return {
          content: [
            {
              type: "text",
              text: `成功向飞书追加内容！\n- ID: ${result.documentId}\n- 新增块数/记录数: ${result.appendedBlocks}\n- 链接: ${result.url}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `向飞书写入内容失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // 4. 获取文档基本元信息
  server.tool(
    "feishu_get_document_info",
    "获取飞书文档的基本元信息（标题、最新版本号、查看设置及访问链接等）",
    {
      document_id_or_url: z
        .string()
        .describe("飞书文档的 URL 或 document_id / wiki_token"),
    },
    async ({ document_id_or_url }) => {
      try {
        const info = await getDocumentInfo(document_id_or_url);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `获取飞书文档信息失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // 5. 全量更新/覆盖飞书文档或多维表格内容
  server.tool(
    "feishu_update_document",
    "全量更新/覆盖飞书云文档 (Docx) 或多维表格 (Bitable) 内容（云文档清空旧正文并替换为新内容；多维表格清空旧记录并导入新记录）",
    {
      document_id_or_url: z
        .string()
        .describe("目标飞书文档或多维表格的 URL 或 document_id / wiki_token / app_token"),
      content: z
        .string()
        .describe("要更新替换的全新内容。云文档支持 Markdown 格式；多维表格支持 Markdown 表格、JSON 记录数组或键值对"),
      title: z
        .string()
        .optional()
        .describe("可选。若需同时修改文档标题，可传入新标题"),
    },
    async ({ document_id_or_url, content, title }) => {
      try {
        const result = await updateDocumentContent(document_id_or_url, content, {
          title,
        });

        return {
          content: [
            {
              type: "text",
              text: `飞书文档已成功全量更新！\n- 标题: ${result.title}\n- 文档 ID: ${result.documentId}\n- 重新写入块数: ${result.updatedBlocks}\n- 链接: ${result.url}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `全量更新飞书文档失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // 6. 局部更新指定块内容
  server.tool(
    "feishu_patch_block",
    "更新/修改飞书文档中的指定块 (Block) 的文本内容",
    {
      document_id_or_url: z
        .string()
        .describe("目标飞书文档的 URL 或 document_id"),
      block_id: z
        .string()
        .describe("需要修改的块 ID（可通过 feishu_read_document format='raw_blocks' 获取）"),
      content: z
        .string()
        .describe("更新后的新文本内容"),
    },
    async ({ document_id_or_url, block_id, content }) => {
      try {
        const result = await patchDocumentBlock(document_id_or_url, block_id, content);

        return {
          content: [
            {
              type: "text",
              text: `块内容修改成功！\n- 文档 ID: ${result.documentId}\n- 块 ID: ${result.blockId}\n- 新内容: ${result.content}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `修改飞书块内容失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // 7. 在飞书知识库中检索文档
  server.tool(
    "feishu_search_wiki",
    "在飞书知识库 (Wiki) 中检索文档。优先匹配团队权威索引推荐项（⭐ 标记），其次在限定目录下按相关度排序返回。返回 Token/URL 可配合 feishu_read_document 读取全文",
    {
      query: z
        .string()
        .describe(
          "检索关键词或技术实体。支持口语化问句，服务会自动识别团队专有名词、技术缩写与常见写法；包含 1~3 个核心概念时效果最佳。"
        ),
      space_id: z
        .string()
        .optional()
        .describe("知识库空间 ID 或空间链接。可选，若不指定则在所有有权限的知识空间中搜索"),
      parent_node_token: z
        .string()
        .optional()
        .describe("目标父目录/文件夹节点的 Wiki Token、节点 URL 或目录名称（如 '规范与标准'、'AZ5awBTNviWQvEkFIkIcjsYJnae'）。若指定，则仅在该目录及其子目录下递归检索，显著提升检索速度并避免全空间范围扫描"),
      index_node_token: z
        .string()
        .optional()
        .describe("权威规范导航索引文档的 Wiki Token 或 URL（例如 'HET8wUwdgivtMtkp7QocSD9pn2e'）。若指定，则优先读取并匹配该索引页正文表格及直达链接"),
      page_size: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .optional()
        .describe("返回结果数量，默认 10，最大 50"),
    },
    async ({ query, space_id, parent_node_token, index_node_token, page_size }) => {
      try {
        const result = await searchWiki(query, {
          spaceId: space_id,
          parentNodeToken: parent_node_token,
          indexNodeToken: index_node_token,
          pageSize: page_size || 10,
        });

        if (result.total === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  result.message ||
                  `未找到与 "${query}" 相关的飞书知识库文档。建议尝试更通用的关键词，或使用 feishu_list_wiki_spaces 检查可访问的知识库列表。`,
              },
            ],
          };
        }

        const formattedList = result.items
          .map((item, index) => {
            const tokenStr = item.wikiToken
              ? `wikiToken: \`${item.wikiToken}\``
              : `documentId: \`${item.documentId}\``;
            const summaryStr = item.summary ? `\n   - **摘要**: ${item.summary}` : "";
            const spaceStr = item.spaceId ? ` (空间: \`${item.spaceId}\`)` : "";
            const authorStr = item.ownerName ? ` | 作者: ${item.ownerName}` : "";

            return `${index + 1}. **[${item.title}](${item.url})** [${item.objType}]${spaceStr}
   - **标识**: ${tokenStr}${authorStr}${summaryStr}`;
          })
          .join("\n\n");

        const dirStr = result.parentNodeToken ? ` | 限制目录: \`${result.parentNodeToken}\`` : "";
        const indexStr = result.indexNodeToken ? ` | 优先索引: \`${result.indexNodeToken}\`` : "";
        const textOutput = `### 飞书知识库检索结果（共 ${result.total} 条，来源: ${result.source}）
检索词: "${query}"${result.spaceId ? ` | 空间 ID: \`${result.spaceId}\`` : ""}${dirStr}${indexStr}

${formattedList}

---
💡 **后续操作指引**：可直接复制上述文档的 **URL** 或 **标识 Token**，调用 \`feishu_read_document\` 读取该文档的详细 Markdown 内容。`;

        return {
          content: [
            {
              type: "text",
              text: textOutput,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `飞书知识库检索失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  // 8. 列出当前有权限访问的知识库空间
  server.tool(
    "feishu_list_wiki_spaces",
    "列出当前应用/机器人有权限访问的所有飞书知识库空间（Wiki Spaces），可用于获取目标知识库的 space_id",
    {
      page_size: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .optional()
        .describe("返回空间数量，默认 20，最大 50"),
    },
    async ({ page_size }) => {
      try {
        const result = await listWikiSpaces(page_size || 20);

        if (result.spaces.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "当前自建应用/机器人暂未获得任何飞书知识库空间的访问权限。请前往飞书知识库的「空间设置 -> 成员管理」，将机器人添加为空间成员并授予阅读权限。",
              },
            ],
          };
        }

        const list = result.spaces
          .map(
            (s, index) =>
              `${index + 1}. **${s.name}** (Space ID: \`${s.spaceId}\`)${s.description ? `\n   - 描述: ${s.description}` : ""}`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `### 当前可访问的飞书知识空间列表（共 ${result.spaces.length} 个）\n\n${list}\n\n💡 提示：在调用 \`feishu_search_wiki\` 时，可将目标知识库的 \`Space ID\` 作为 \`space_id\` 参数传入，以限定只在该知识库内精准搜索。`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `获取知识库空间列表失败: ${error.message || String(error)}`,
            },
          ],
        };
      }
    },
  );

  return server;
}
