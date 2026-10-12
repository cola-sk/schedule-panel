import "server-only";
import pLimit from "p-limit";
import { getFeishuClient, parseDocumentTarget, formatLarkError } from "@/lib/mcp/feishu-doc-engine";
import {
  DriveFileItem,
  DriveFileType,
  WikiDirectoryNode,
  ScanDriveResult,
  MigrateItemParam,
  MigrateSingleResult,
  BatchMigrateResponse,
} from "./types";
import {
  getDriveMigrationTask,
  updateDriveMigrationTask,
  updateDriveMigrationTaskItem,
} from "./store";

/**
 * 解析网盘文件夹 URL 或 Token
 */
export function parseDriveFolderTarget(urlOrToken: string): { folderToken: string; isRoot?: boolean } {
  const trimmed = urlOrToken.trim();
  if (trimmed.includes("/drive/folder/")) {
    const match = trimmed.match(/\/drive\/folder\/([a-zA-Z0-9_-]+)/);
    if (match) return { folderToken: match[1] };
  }
  if (trimmed.includes("/drive/me") || trimmed.includes("/drive/home") || trimmed === "") {
    return { folderToken: "", isRoot: true };
  }
  const cleanToken = trimmed.replace(/^https?:\/\/[^/]+\//, "").split(/[?#]/)[0];
  return { folderToken: cleanToken || trimmed };
}

/**
 * 递归/单层扫描网盘文件夹下的文件清单
 */
export async function scanDriveFolder(input: {
  folderToken: string;
  recursive?: boolean;
  maxDepth?: number;
}): Promise<DriveFileItem[]> {
  const client = getFeishuClient();
  const recursive = input.recursive !== false;
  const maxDepth = input.maxDepth ?? 5;
  const resultFiles: DriveFileItem[] = [];
  const visitedFolders = new Set<string>();

  async function listFolderContents(folderToken: string, currentPath: string, depth: number) {
    if (depth > maxDepth || visitedFolders.has(folderToken)) return;
    visitedFolders.add(folderToken);

    let pageToken: string | undefined;
    do {
      let res;
      try {
        res = await client.drive.file.list({
          params: {
            folder_token: folderToken || undefined,
            page_size: 100,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
      } catch (error: any) {
        throw new Error(
          formatLarkError(
            error,
            `读取个人网盘文件夹列表失败 (folder: ${folderToken || "根目录"})。请确认该文件夹已在飞书中分享给机器人作为协作者（可阅读/可编辑）。`,
          ),
        );
      }

      if (res.code !== 0) {
        throw new Error(
          formatLarkError(
            res,
            `读取个人网盘文件夹列表失败 (folder: ${folderToken || "根目录"})。请确认该文件夹已在飞书中分享给机器人。`,
          ),
        );
      }

      const files = res.data?.files ?? [];
      for (const file of files) {
        const fileType = (file.type as DriveFileType) || "unknown";
        const item: DriveFileItem = {
          token: file.token,
          name: file.name || "未命名文件",
          type: fileType,
          parentToken: folderToken,
          parentPath: currentPath || "/",
          url: file.url,
          modifiedTime: file.modified_time,
          size: (file as any).size ? Number((file as any).size) : undefined,
        };

        if (fileType === "folder") {
          resultFiles.push(item);
          if (recursive) {
            const nextPath = `${currentPath}/${file.name}`.replace(/\/+/g, "/");
            await listFolderContents(file.token, nextPath, depth + 1);
          }
        } else {
          resultFiles.push(item);
        }
      }

      pageToken = res.data?.has_more ? res.data.next_page_token : undefined;
    } while (pageToken);
  }

  await listFolderContents(input.folderToken, "/", 0);
  return resultFiles;
}

/**
 * 快速解析知识库 spaceId 与根信息（仅轻量调用单节点查询，无需全量递归扫描整个知识库）
 */
export async function resolveWikiSpaceInfo(targetWikiUrl: string): Promise<{
  spaceId: string;
  rootToken: string;
  origin: string;
}> {
  const parsed = parseDocumentTarget(targetWikiUrl);
  if (!parsed.wikiToken) {
    throw new Error("请填写有效的飞书知识库 URL 或 wikiToken");
  }

  let origin = "https://open.feishu.cn";
  try {
    origin = new URL(targetWikiUrl.startsWith("http") ? targetWikiUrl : `https://${targetWikiUrl}`).origin;
  } catch {
    // ignore
  }

  const client = getFeishuClient();
  const rootResult = await client.wiki.space.getNode({
    params: { token: parsed.wikiToken, obj_type: "wiki" },
  });

  if (rootResult.code !== 0 || !rootResult.data?.node?.space_id) {
    throw new Error(formatLarkError(rootResult, "读取飞书知识库根节点失败"));
  }

  return {
    spaceId: rootResult.data.node.space_id,
    rootToken: parsed.wikiToken,
    origin,
  };
}

/**
 * 获取知识库的目录节点树（包含所有层级）
 */
export async function fetchWikiDirectories(targetWikiUrl: string): Promise<{
  spaceId: string;
  rootToken: string;
  rootTitle: string;
  origin: string;
  directories: WikiDirectoryNode[];
}> {
  const parsed = parseDocumentTarget(targetWikiUrl);
  if (!parsed.wikiToken) {
    throw new Error("请填写有效的飞书知识库 URL 或 wikiToken");
  }

  let origin = "https://open.feishu.cn";
  try {
    origin = new URL(targetWikiUrl.startsWith("http") ? targetWikiUrl : `https://${targetWikiUrl}`).origin;
  } catch {
    // ignore
  }

  const client = getFeishuClient();
  let rootResult;
  try {
    rootResult = await client.wiki.space.getNode({
      params: { token: parsed.wikiToken, obj_type: "wiki" },
    });
  } catch (error: any) {
    throw new Error(formatLarkError(error, "读取飞书知识库根节点失败"));
  }

  if (rootResult.code !== 0 || !rootResult.data?.node?.space_id) {
    throw new Error(formatLarkError(rootResult, "读取飞书知识库根节点失败"));
  }

  const spaceId = rootResult.data.node.space_id;
  const rootNode = rootResult.data.node;
  const rootTitle = rootNode.title?.trim() || "知识库根目录";

  const directories: WikiDirectoryNode[] = [
    {
      nodeToken: parsed.wikiToken,
      title: `[知识库根目录] ${rootTitle}`,
      parentNodeToken: undefined,
      path: rootTitle,
      depth: 0,
      hasChild: true,
    },
  ];

  const visited = new Set<string>();

  async function listChildNodes(parentToken: string, currentPath: string, depth: number) {
    if (visited.has(parentToken) || depth > 8) return;
    visited.add(parentToken);

    let pageToken: string | undefined;
    do {
      let res;
      try {
        res = await client.wiki.spaceNode.list({
          path: { space_id: spaceId },
          params: {
            parent_node_token: parentToken,
            page_size: 50,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
      } catch (err) {
        console.warn(`读取知识库子节点失败 (parentToken: ${parentToken}):`, err);
        break;
      }

      if (res.code !== 0) break;
      const items = res.data?.items ?? [];

      for (const item of items) {
        if (!item.node_token) continue;
        const itemTitle = item.title?.trim() || "无标题节点";
        const itemPath = `${currentPath} / ${itemTitle}`;
        directories.push({
          nodeToken: item.node_token,
          title: itemTitle,
          objType: item.obj_type,
          parentNodeToken: parentToken,
          path: itemPath,
          depth: depth + 1,
          hasChild: item.has_child,
        });

        if (item.has_child) {
          await listChildNodes(item.node_token, itemPath, depth + 1);
        }
      }

      pageToken = res.data?.has_more ? res.data.page_token : undefined;
    } while (pageToken);
  }

  // 1. 先尝试读取作为父节点的子列表
  await listChildNodes(parsed.wikiToken, rootTitle, 0);

  // 2. 如果传的是空间顶层文档且以 parent_node_token 查不到子节点，尝试读取 space-level nodes
  if (directories.length === 1) {
    let pageToken: string | undefined;
    do {
      let res;
      try {
        res = await client.wiki.spaceNode.list({
          path: { space_id: spaceId },
          params: {
            page_size: 50,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
      } catch {
        break;
      }
      if (res.code !== 0) break;
      const items = res.data?.items ?? [];
      for (const item of items) {
        if (!item.node_token || item.node_token === parsed.wikiToken) continue;
        const itemTitle = item.title?.trim() || "无标题节点";
        const itemPath = `${rootTitle} / ${itemTitle}`;
        directories.push({
          nodeToken: item.node_token,
          title: itemTitle,
          objType: item.obj_type,
          parentNodeToken: parsed.wikiToken,
          path: itemPath,
          depth: 1,
          hasChild: item.has_child,
        });
        if (item.has_child) {
          await listChildNodes(item.node_token, itemPath, 1);
        }
      }
      pageToken = res.data?.has_more ? res.data.page_token : undefined;
    } while (pageToken);
  }

  return {
    spaceId,
    rootToken: parsed.wikiToken,
    rootTitle,
    origin,
    directories,
  };
}

/**
 * 完整扫描个人网盘及知识库目录
 */
export async function performScan(input: {
  folderUrlOrToken: string;
  targetWikiUrl: string;
  recursive?: boolean;
}): Promise<ScanDriveResult> {
  const parsedFolder = parseDriveFolderTarget(input.folderUrlOrToken);
  const [files, wikiInfo] = await Promise.all([
    scanDriveFolder({
      folderToken: parsedFolder.folderToken,
      recursive: input.recursive !== false,
    }),
    fetchWikiDirectories(input.targetWikiUrl),
  ]);

  const typeCounts: Record<string, number> = {};
  let totalFiles = 0;
  let totalFolders = 0;

  for (const f of files) {
    if (f.type === "folder") {
      totalFolders++;
    } else {
      totalFiles++;
    }
    typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
  }

  return {
    folderInfo: {
      token: parsedFolder.folderToken,
    },
    files,
    wiki: {
      spaceId: wikiInfo.spaceId,
      rootToken: wikiInfo.rootToken,
      rootTitle: wikiInfo.rootTitle,
      directories: wikiInfo.directories,
    },
    stats: {
      totalFiles,
      totalFolders,
      typeCounts,
    },
  };
}

/**
 * 规范化飞书可迁移的 obj_type
 */
function normalizeObjType(type: string): "doc" | "sheet" | "bitable" | "mindnote" | "docx" | "file" | "slides" {
  if (type === "docx") return "docx";
  if (type === "doc") return "doc";
  if (type === "sheet" || type === "sheets") return "sheet";
  if (type === "bitable" || type === "base") return "bitable";
  if (type === "slides") return "slides";
  if (type === "mindnote") return "mindnote";
  return "file";
}

/**
 * 批量迁移文件至飞书知识库
 */
export async function executeBatchMigration(input: {
  targetWikiUrl: string;
  targetParentNodeToken: string;
  items: MigrateItemParam[];
}): Promise<BatchMigrateResponse> {
  const client = getFeishuClient();
  const wikiInfo = await fetchWikiDirectories(input.targetWikiUrl);
  const spaceId = wikiInfo.spaceId;
  const origin = wikiInfo.origin;

  const defaultParentToken = input.targetParentNodeToken || wikiInfo.rootToken;
  const limit = pLimit(2); // 限制并发，避免触发飞书频控

  const results: MigrateSingleResult[] = await Promise.all(
    input.items.map((item) =>
      limit(async (): Promise<MigrateSingleResult> => {
        const parentToken = item.customTargetParentToken || defaultParentToken;
        const objType = normalizeObjType(item.type);

        if (item.type === "folder") {
          return {
            token: item.token,
            name: item.name,
            type: item.type,
            status: "skipped",
            error: "文件夹暂不直接迁移，请直接勾选并迁移文件夹内的具体文档",
          };
        }

        try {
          const res = await client.wiki.spaceNode.moveDocsToWiki({
            path: { space_id: spaceId },
            data: {
              parent_wiki_token: parentToken,
              obj_type: objType,
              obj_token: item.token,
              apply: true,
            },
          });

          if (res.code !== 0) {
            return {
              token: item.token,
              name: item.name,
              type: item.type,
              status: "failed",
              error: formatLarkError(res, "迁移至知识库失败"),
            };
          }

          const wikiToken = res.data?.wiki_token;
          const url = wikiToken ? `${origin}/wiki/${wikiToken}` : undefined;

          return {
            token: item.token,
            name: item.name,
            type: item.type,
            status: "success",
            wikiToken,
            url,
          };
        } catch (error: any) {
          return {
            token: item.token,
            name: item.name,
            type: item.type,
            status: "failed",
            error: formatLarkError(error, "迁移至知识库失败"),
          };
        }
      }),
    ),
  );

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of results) {
    if (r.status === "success") success++;
    else if (r.status === "failed") failed++;
    else skipped++;
  }

  return {
    results,
    summary: {
      total: input.items.length,
      success,
      failed,
      skipped,
    },
  };
}

/**
 * 后台异步执行网盘迁移任务
 */
export async function startBackgroundMigrationTask(taskId: string): Promise<void> {
  const task = getDriveMigrationTask(taskId);
  if (!task) return;

  const client = getFeishuClient();
  let wikiInfo;
  try {
    wikiInfo = await resolveWikiSpaceInfo(task.targetWikiUrl);
  } catch (err: any) {
    updateDriveMigrationTask(taskId, {
      status: "failed",
      currentFile: undefined,
    });
    return;
  }

  const spaceId = wikiInfo.spaceId;
  const origin = wikiInfo.origin;
  const defaultParentToken = task.targetParentNodeToken || wikiInfo.rootToken;
  const limit = pLimit(2);

  const pendingItems = task.items.filter((i) => i.status === "pending");

  await Promise.all(
    pendingItems.map((item) =>
      limit(async () => {
        const parentToken = item.customTargetParentToken || defaultParentToken;
        const objType = normalizeObjType(item.type);

        updateDriveMigrationTaskItem(taskId, item.token, { status: "migrating" });
        updateDriveMigrationTask(taskId, { currentFile: item.name });

        if (item.type === "folder") {
          updateDriveMigrationTaskItem(taskId, item.token, {
            status: "skipped",
            error: "文件夹暂不直接迁移，请直接迁移文件夹内的具体文档",
          });
          const current = getDriveMigrationTask(taskId);
          if (current) {
            updateDriveMigrationTask(taskId, {
              progress: {
                ...current.progress,
                completed: current.progress.completed + 1,
                skipped: current.progress.skipped + 1,
              },
            });
          }
          return;
        }

        try {
          const res = await client.wiki.spaceNode.moveDocsToWiki({
            path: { space_id: spaceId },
            data: {
              parent_wiki_token: parentToken,
              obj_type: objType,
              obj_token: item.token,
              apply: true,
            },
          });

          if (res.code !== 0) {
            const errorMsg = formatLarkError(res, "迁移至知识库失败");
            updateDriveMigrationTaskItem(taskId, item.token, {
              status: "failed",
              error: errorMsg,
            });
            const current = getDriveMigrationTask(taskId);
            if (current) {
              updateDriveMigrationTask(taskId, {
                progress: {
                  ...current.progress,
                  completed: current.progress.completed + 1,
                  failed: current.progress.failed + 1,
                },
              });
            }
            return;
          }

          const wikiToken = res.data?.wiki_token;
          const url = wikiToken ? `${origin}/wiki/${wikiToken}` : undefined;

          updateDriveMigrationTaskItem(taskId, item.token, {
            status: "success",
            wikiToken,
            url,
          });
          const current = getDriveMigrationTask(taskId);
          if (current) {
            updateDriveMigrationTask(taskId, {
              progress: {
                ...current.progress,
                completed: current.progress.completed + 1,
                success: current.progress.success + 1,
              },
            });
          }
        } catch (error: any) {
          const errorMsg = formatLarkError(error, "迁移至知识库失败");
          updateDriveMigrationTaskItem(taskId, item.token, {
            status: "failed",
            error: errorMsg,
          });
          const current = getDriveMigrationTask(taskId);
          if (current) {
            updateDriveMigrationTask(taskId, {
              progress: {
                ...current.progress,
                completed: current.progress.completed + 1,
                failed: current.progress.failed + 1,
              },
            });
          }
        }
      }),
    ),
  );

  const finalTask = getDriveMigrationTask(taskId);
  if (finalTask) {
    const isAllFailed = finalTask.progress.failed === finalTask.progress.total && finalTask.progress.total > 0;
    updateDriveMigrationTask(taskId, {
      status: isAllFailed ? "failed" : "completed",
      currentFile: undefined,
    });
  }
}
