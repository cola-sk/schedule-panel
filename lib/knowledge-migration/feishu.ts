import "server-only";
import pLimit from "p-limit";
import { getFeishuClient, parseDocumentTarget, appendDocumentContent, updateDocumentContent, formatLarkError } from "@/lib/mcp/feishu-doc-engine";
import { taxonomyFromDirectories, type DynamicTaxonomy, type KnowledgeDirectory, type PrimaryCategory, type SecondaryCategory } from "./types";

export type WikiNode = {
  node_token?: string;
  obj_token?: string;
  title?: string;
  obj_type?: string;
  parent_node_token?: string;
  has_child?: boolean;
  url?: string;
};

export type FeishuDocNode = {
  nodeToken: string;
  documentToken: string;
  title: string;
  parentNodeToken?: string;
  url?: string;
};

export type WikiDestination = {
  spaceId: string;
  rootToken: string;
  folders: Map<string, string>;
  directories: KnowledgeDirectory[];
  taxonomy: DynamicTaxonomy;
  existingNodesByToken: Map<string, FeishuDocNode>;
  existingNodesByParentAndTitle: Map<string, FeishuDocNode>;
};

function categoryKey(primary: string, secondary: string) {
  return `${primary}/${secondary}`;
}

export async function checkWikiNodeExists(spaceId: string, nodeToken: string, origin?: string): Promise<FeishuDocNode | null> {
  const client = getFeishuClient();
  try {
    const res = await client.wiki.space.getNode({ params: { token: nodeToken, obj_type: "wiki" } });
    const node = res.data?.node;
    if (res.code === 0 && node && node.node_token && node.obj_token) {
      return {
        nodeToken: node.node_token,
        documentToken: node.obj_token,
        title: node.title || "",
        parentNodeToken: node.parent_node_token,
        url: node.url || (origin ? `${origin}/wiki/${node.node_token}` : undefined),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function listChildren(spaceId: string, parentToken: string): Promise<WikiNode[]> {
  const client = getFeishuClient();
  const items: WikiNode[] = [];
  let pageToken: string | undefined;
  do {
    let response;
    try {
      response = await client.wiki.spaceNode.list({
        path: { space_id: spaceId },
        params: { parent_node_token: parentToken, page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
      });
    } catch (error) {
      throw new Error(formatLarkError(error, "读取飞书知识库目录失败"));
    }
    if (response.code !== 0) throw new Error(formatLarkError(response, "读取飞书知识库目录失败"));
    items.push(...((response.data?.items ?? []) as WikiNode[]));
    pageToken = response.data?.has_more ? response.data.page_token : undefined;
  } while (pageToken);
  return items;
}

/**
 * Some knowledge spaces use a normal Docx as a cover/index page. The visible
 * category nodes are then space-level nodes with an empty parent token rather
 * than children of that Docx's wiki token.
 */
async function listSpaceRootNodes(spaceId: string): Promise<WikiNode[]> {
  const client = getFeishuClient();
  const items: WikiNode[] = [];
  let pageToken: string | undefined;
  do {
    let response;
    try {
      response = await client.wiki.spaceNode.list({
        path: { space_id: spaceId },
        params: { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
      });
    } catch (error) {
      throw new Error(formatLarkError(error, "读取飞书知识库顶层目录失败"));
    }
    if (response.code !== 0) throw new Error(formatLarkError(response, "读取飞书知识库顶层目录失败"));
    items.push(...((response.data?.items ?? []) as WikiNode[]));
    pageToken = response.data?.has_more ? response.data.page_token : undefined;
  } while (pageToken);
  return items;
}

export async function loadWikiDestination(
  config: { targetWikiRoot: string },
  options?: { fetchExistingDocs?: boolean }
): Promise<WikiDestination> {
  const parsed = parseDocumentTarget(config.targetWikiRoot);
  if (!parsed.wikiToken) throw new Error("请填写有效的飞书知识库根节点 URL 或 wiki token");
  const client = getFeishuClient();
  let rootResult;
  try {
    rootResult = await client.wiki.space.getNode({ params: { token: parsed.wikiToken, obj_type: "wiki" } });
  } catch (error) {
    throw new Error(formatLarkError(error, "读取飞书知识库根节点失败"));
  }
  const spaceId = rootResult.data?.node?.space_id;
  if (rootResult.code !== 0 || !spaceId) throw new Error(formatLarkError(rootResult, "读取飞书知识库根节点失败"));

  let primaryNodes = await listChildren(spaceId, parsed.wikiToken);
  // The supplied URL can point to a cover/index document rather than a
  // structural parent node. In that layout the actual categories are returned
  // by the space-level listing (parent_node_token omitted).
  if (!primaryNodes.length) {
    const spaceRootNodes = await listSpaceRootNodes(spaceId);
    primaryNodes = spaceRootNodes.filter((node) => node.node_token !== parsed.wikiToken);
  }
  const folders = new Map<string, string>();
  const directories: KnowledgeDirectory[] = [];
  const secondaryTokens: string[] = [];

  for (const primaryNode of primaryNodes) {
    if (!primaryNode.title || !primaryNode.node_token) continue;
    // 记录一级目录自身的 token，支持直接迁移到一级目录下
    folders.set(primaryNode.title, primaryNode.node_token);
    folders.set(categoryKey(primaryNode.title, ""), primaryNode.node_token);

    const secondaryNodes = await listChildren(spaceId, primaryNode.node_token);
    const children = secondaryNodes
      .filter((node): node is WikiNode & { title: string; node_token: string } => Boolean(node.title && node.node_token))
      .map((node) => {
        secondaryTokens.push(node.node_token);
        return { title: node.title, nodeToken: node.node_token };
      });
    directories.push({ title: primaryNode.title, nodeToken: primaryNode.node_token, children });
    children.forEach((child) => folders.set(categoryKey(primaryNode.title!, child.title), child.nodeToken));
  }
  const taxonomy = taxonomyFromDirectories(directories);
  if (!Object.keys(taxonomy).length) {
    const rootTitle = rootResult.data?.node?.title || parsed.wikiToken;
    throw new Error(`已识别飞书根节点“${rootTitle}”，但应用读取到的子节点列表为空。飞书会在应用缺少页面树/父节点阅读权限时返回空列表，请将当前自建应用添加为该知识库成员并授予页面树查看权限，同时确认权限变更已发布到最新应用版本；若权限已确认，请检查 URL 是否确实指向分类目录的父节点。`);
  }

  const existingNodesByToken = new Map<string, FeishuDocNode>();
  const existingNodesByParentAndTitle = new Map<string, FeishuDocNode>();
  let origin = "https://open.feishu.cn";
  try {
    origin = new URL(config.targetWikiRoot.startsWith("http") ? config.targetWikiRoot : `https://${config.targetWikiRoot}`).origin;
  } catch {
    // ignore
  }

  // 深度扫描各分类目录下的所有现有文档（用于双向对齐与防重复迁移）
  if (options?.fetchExistingDocs !== false && (secondaryTokens.length > 0 || primaryNodes.length > 0)) {
    const limit = pLimit(5);
    async function traverseDocTree(parentToken: string) {
      const children = await listChildren(spaceId!, parentToken);
      for (const child of children) {
        if (child.node_token && child.obj_token && child.title) {
          const docNode: FeishuDocNode = {
            nodeToken: child.node_token,
            documentToken: child.obj_token,
            title: child.title,
            parentNodeToken: parentToken,
            url: child.url || `${origin}/wiki/${child.node_token}`,
          };
          existingNodesByToken.set(child.node_token, docNode);
          existingNodesByParentAndTitle.set(`${parentToken}:::${child.title.trim()}`, docNode);
          if (child.has_child) {
            await traverseDocTree(child.node_token);
          }
        }
      }
    }

    const scanTokens = Array.from(new Set([...secondaryTokens, ...primaryNodes.map((n) => n.node_token!).filter(Boolean)]));
    await Promise.all(
      scanTokens.map((token) =>
        limit(async () => {
          try {
            await traverseDocTree(token);
          } catch (err) {
            console.warn(`读取飞书目录 [${token}] 下文档节点列表失败:`, err);
          }
        })
      )
    );
  }

  return {
    spaceId,
    rootToken: parsed.wikiToken,
    folders,
    directories,
    taxonomy,
    existingNodesByToken,
    existingNodesByParentAndTitle,
  };
}

export async function createMigratedWikiDocument(input: {
  destination: WikiDestination;
  config: { targetWikiRoot: string };
  primaryCategory: PrimaryCategory;
  secondaryCategory?: SecondaryCategory;
  /** 指定父 Wiki 节点时，优先挂载到该节点下，用于按源目录树迁移。 */
  parentNodeToken?: string;
  title: string;
  markdown: string;
}) {
  const parentToken =
    input.parentNodeToken ||
    (input.secondaryCategory ? input.destination.folders.get(categoryKey(input.primaryCategory, input.secondaryCategory)) : undefined) ||
    input.destination.folders.get(input.primaryCategory) ||
    input.destination.folders.get(categoryKey(input.primaryCategory, ""));
  if (!parentToken) throw new Error("未找到已确认的飞书目标目录 token");

  let origin = "https://open.feishu.cn";
  try {
    origin = new URL(input.config.targetWikiRoot.startsWith("http") ? input.config.targetWikiRoot : `https://${input.config.targetWikiRoot}`).origin;
  } catch {
    // ignore
  }

  // 幂等防重检查：如果目标父节点下已存在同名文档，直接复用该节点并全量覆盖写入内容，杜绝重复创建文档
  const existingNode = input.destination.existingNodesByParentAndTitle?.get(`${parentToken}:::${input.title.trim()}`);
  if (existingNode) {
    try {
      await updateDocumentContent(existingNode.documentToken, input.markdown, { title: input.title });
    } catch (updateErr) {
      console.warn("更新已有飞书文档内容提示:", updateErr);
      try {
        await appendDocumentContent(existingNode.documentToken, input.markdown);
      } catch {
        // ignore
      }
    }
    return {
      nodeToken: existingNode.nodeToken,
      documentToken: existingNode.documentToken,
      parentNodeToken: existingNode.parentNodeToken || parentToken,
      url: existingNode.url || `${origin}/wiki/${existingNode.nodeToken}`,
    };
  }

  const client = getFeishuClient();
  let created: any;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      created = await client.wiki.spaceNode.create({
        path: { space_id: input.destination.spaceId },
        data: { obj_type: "docx", node_type: "origin", parent_node_token: parentToken, title: input.title },
      });
      // 飞书 SDK 可能会将业务错误以对象形式返回，或直接抛错
      const code = created?.code ?? created?.response?.data?.code;
      const msg = created?.msg || created?.message || "";
      const isLockContention =
        code === 131009 ||
        msg.includes("131009") ||
        msg.includes("lock contention") ||
        msg.includes("resource locked");

      if (isLockContention && attempt < maxAttempts) {
        const delay = 1000 * attempt + Math.floor(Math.random() * 500);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (created.code !== 0) {
        throw created;
      }
      break;
    } catch (error: any) {
      const code = error?.code ?? error?.response?.data?.code;
      const msg = error?.msg || error?.message || "";
      const isLockContention =
        code === 131009 ||
        msg.includes("131009") ||
        msg.includes("lock contention") ||
        msg.includes("resource locked");

      if (isLockContention && attempt < maxAttempts) {
        const delay = 1000 * attempt + Math.floor(Math.random() * 500);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error(formatLarkError(error, "在飞书知识库创建文档失败"));
    }
  }

  const node = created?.data?.node;
  if (!node?.node_token || !node?.obj_token) {
    throw new Error(formatLarkError(created, "在飞书知识库创建文档失败"));
  }

  await appendDocumentContent(node.obj_token, input.markdown);
  const resultNode = {
    nodeToken: node.node_token,
    documentToken: node.obj_token,
    parentNodeToken: parentToken,
    url: node.url || `${origin}/wiki/${node.node_token}`,
  };

  // 记录到内存 existingNodes 缓存中
  const newDocNode: FeishuDocNode = {
    nodeToken: resultNode.nodeToken,
    documentToken: resultNode.documentToken,
    title: input.title,
    parentNodeToken: parentToken,
    url: resultNode.url,
  };
  input.destination.existingNodesByToken?.set(resultNode.nodeToken, newDocNode);
  input.destination.existingNodesByParentAndTitle?.set(`${parentToken}:::${input.title.trim()}`, newDocNode);

  return resultNode;
}
