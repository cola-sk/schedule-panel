import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readDocument,
  createDocument,
  appendDocumentContent,
  updateDocumentContent,
  patchDocumentBlock,
  getDocumentInfo,
} from "./feishu-doc-engine";

/**
 * 创建并配置飞书文档 MCP Server
 */
export function createFeishuMcpServer(): McpServer {
  const server = new McpServer({
    name: "feishu-document-mcp",
    version: "1.0.0",
  });

  // 1. 读取飞书文档
  server.tool(
    "feishu_read_document",
    "读取飞书云文档 (Docx) 或知识库 (Wiki) 的内容，并转换为结构良好的 Markdown 格式或纯文本",
    {
      document_id_or_url: z
        .string()
        .describe("飞书文档的 URL（如 https://.../docx/xxx 或 /wiki/xxx）或 document_id / wiki_token"),
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

  // 3. 向现有飞书文档追加内容
  server.tool(
    "feishu_append_document",
    "向指定的飞书云文档 (Docx) 末尾追加 Markdown 格式内容（自动解析标题、代码块、列表、引用与段落并写入）",
    {
      document_id_or_url: z
        .string()
        .describe("目标飞书文档的 URL 或 document_id"),
      content: z
        .string()
        .describe("要追加的 Markdown 格式内容（支持 # 标题、- 无序列表、1. 有序列表、``` 代码块、> 引用、--- 分割线等）"),
    },
    async ({ document_id_or_url, content }) => {
      try {
        const result = await appendDocumentContent(document_id_or_url, content);

        return {
          content: [
            {
              type: "text",
              text: `成功向飞书文档追加内容！\n- 文档 ID: ${result.documentId}\n- 新增块数: ${result.appendedBlocks}\n- 链接: ${result.url}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `向飞书文档写入内容失败: ${error.message || String(error)}`,
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

  // 5. 全量更新/覆盖飞书文档正文内容
  server.tool(
    "feishu_update_document",
    "全量更新/覆盖飞书云文档 (Docx) 正文内容（清空旧正文并替换为新的 Markdown 内容，可选择同时更新标题）",
    {
      document_id_or_url: z
        .string()
        .describe("目标飞书文档的 URL 或 document_id / wiki_token"),
      content: z
        .string()
        .describe("要更新替换的全新 Markdown 格式正文内容（支持标题、列表、代码块、引用等）"),
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

  return server;
}
