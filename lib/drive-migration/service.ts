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
  getDriveMigrationTasks,
  getDriveMigrationStats,
  updateDriveMigrationTask,
  updateDriveMigrationTaskItem,
  recordDriveMigrationStats,
} from "./store";
import type { MigratedFileRecord } from "./types";

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
        const isShortcut = file.type === "shortcut";
        const shortcutInfo = (file as any).shortcut_info;
        const targetToken = shortcutInfo?.target_token;
        const targetType = shortcutInfo?.target_type;
        // 如果是快捷方式，将其实际类型映射为对应云文档类型（如 docx / sheet / file 等）
        const resolvedType = isShortcut
          ? (targetType as DriveFileType) || "file"
          : ((file.type as DriveFileType) || "unknown");

        const item: DriveFileItem = {
          token: file.token,
          name: file.name || "未命名文件",
          type: resolvedType,
          parentToken: folderToken,
          parentPath: currentPath || "/",
          url: file.url,
          modifiedTime: file.modified_time,
          size: (file as any).size ? Number((file as any).size) : undefined,
          isShortcut,
          shortcutToken: isShortcut ? file.token : undefined,
          targetToken: targetToken || file.token,
          targetType: targetType || file.type,
        };

        if (resolvedType === "folder") {
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
          objToken: item.obj_token,
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
          objToken: item.obj_token,
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

  // 1. 读取历史持久化迁移统计与任务记录
  const statsData = getDriveMigrationStats();
  const tasksData = getDriveMigrationTasks();

  const knownMigratedMap = new Map<string, MigratedFileRecord>();
  for (const r of statsData.records) {
    if (r.status === "success") {
      knownMigratedMap.set(r.fileToken, r);
    }
  }
  for (const t of tasksData) {
    for (const item of t.items) {
      if (item.status === "success" && !knownMigratedMap.has(item.token)) {
        knownMigratedMap.set(item.token, {
          fileToken: item.token,
          fileName: item.name,
          fileType: item.type,
          targetWikiUrl: t.targetWikiUrl,
          wikiToken: item.wikiToken,
          wikiUrl: item.url,
          migratedAt: t.updatedAt || t.createdAt,
          status: "success",
          taskId: t.id,
        });
      }
      if (item.targetToken && item.status === "success" && !knownMigratedMap.has(item.targetToken)) {
        knownMigratedMap.set(item.targetToken, {
          fileToken: item.targetToken,
          fileName: item.name,
          fileType: item.type,
          targetWikiUrl: t.targetWikiUrl,
          wikiToken: item.wikiToken,
          wikiUrl: item.url,
          migratedAt: t.updatedAt || t.createdAt,
          status: "success",
          taskId: t.id,
        });
      }
    }
  }

  // 2. 映射目标知识库所有已存在的文档节点（objToken -> wikiNode）
  const wikiObjMap = new Map<string, WikiDirectoryNode>();
  for (const d of wikiInfo.directories) {
    if (d.objToken) {
      wikiObjMap.set(d.objToken, d);
    }
  }

  // 3. 关联并判定每个文档的迁移状态
  const newlyDiscoveredMigrated: MigratedFileRecord[] = [];
  const client = getFeishuClient();
  const checkLimit = pLimit(5);
  const shortcutCheckPromises: Promise<void>[] = [];

  for (const f of files) {
    if (f.type === "folder") continue;

    // A. 历史迁移记录匹配（真实 token、当前 token 或快捷方式 token）
    const match =
      (f.targetToken ? knownMigratedMap.get(f.targetToken) : undefined) ||
      knownMigratedMap.get(f.token) ||
      (f.shortcutToken ? knownMigratedMap.get(f.shortcutToken) : undefined);

    if (match) {
      f.status = "migrated";
      f.wikiToken = match.wikiToken;
      f.wikiUrl = match.wikiUrl || (match.wikiToken ? `${wikiInfo.origin}/wiki/${match.wikiToken}` : undefined);

      // 若历史记录中缺少 wikiToken，尝试从当前知识库目录或接口探测补全
      if (!f.wikiToken) {
        const wikiMatch =
          (f.targetToken ? wikiObjMap.get(f.targetToken) : undefined) ||
          wikiObjMap.get(f.token);
        if (wikiMatch) {
          f.wikiToken = wikiMatch.nodeToken;
          f.wikiUrl = `${wikiInfo.origin}/wiki/${wikiMatch.nodeToken}`;
        } else if (f.targetToken) {
          shortcutCheckPromises.push(
            checkLimit(async () => {
              try {
                const nodeRes = await client.wiki.space.getNode({
                  params: {
                    token: f.targetToken!,
                    obj_type: (f.targetType as any) || "wiki",
                  },
                });
                if (nodeRes.code === 0 && nodeRes.data?.node) {
                  const node = nodeRes.data.node;
                  const nodeToken = node.node_token || (node as any).wiki_token;
                  if (nodeToken) {
                    f.wikiToken = nodeToken;
                    f.wikiUrl = `${wikiInfo.origin}/wiki/${nodeToken}`;
                    newlyDiscoveredMigrated.push({
                      fileToken: f.targetToken || f.token,
                      fileName: f.name,
                      fileType: f.type,
                      sourceDriveToken: parsedFolder.folderToken,
                      targetWikiUrl: input.targetWikiUrl,
                      wikiToken: nodeToken,
                      wikiUrl: f.wikiUrl,
                      migratedAt: new Date().toISOString(),
                      status: "success",
                    });
                  }
                }
              } catch {}
            }),
          );
        }
      }
      continue;
    }

    // B. 目标知识库树节点匹配
    const wikiMatch =
      (f.targetToken ? wikiObjMap.get(f.targetToken) : undefined) ||
      wikiObjMap.get(f.token);

    if (wikiMatch) {
      f.status = "migrated";
      f.wikiToken = wikiMatch.nodeToken;
      f.wikiUrl = `${wikiInfo.origin}/wiki/${wikiMatch.nodeToken}`;
      newlyDiscoveredMigrated.push({
        fileToken: f.targetToken || f.token,
        fileName: f.name,
        fileType: f.type,
        sourceDriveToken: parsedFolder.folderToken,
        targetWikiUrl: input.targetWikiUrl,
        wikiToken: wikiMatch.nodeToken,
        wikiUrl: f.wikiUrl,
        migratedAt: new Date().toISOString(),
        status: "success",
      });
      continue;
    }

    // C. 针对快捷方式，主动探测目标是否已被移入知识库
    if (f.isShortcut && f.targetToken) {
      shortcutCheckPromises.push(
        checkLimit(async () => {
          try {
            const nodeRes = await client.wiki.space.getNode({
              params: {
                token: f.targetToken!,
                obj_type: (f.targetType as any) || "wiki",
              },
            });
            if (nodeRes.code === 0 && nodeRes.data?.node) {
              const node = nodeRes.data.node;
              const nodeToken = node.node_token || (node as any).wiki_token;
              if (nodeToken) {
                f.status = "migrated";
                f.wikiToken = nodeToken;
                f.wikiUrl = `${wikiInfo.origin}/wiki/${nodeToken}`;
                newlyDiscoveredMigrated.push({
                  fileToken: f.targetToken || f.token,
                  fileName: f.name,
                  fileType: f.type,
                  sourceDriveToken: parsedFolder.folderToken,
                  targetWikiUrl: input.targetWikiUrl,
                  wikiToken: nodeToken,
                  wikiUrl: f.wikiUrl,
                  migratedAt: new Date().toISOString(),
                  status: "success",
                });
              }
            }
          } catch {
            // 静默跳过探测异常
          }
        }),
      );
    }
  }

  if (shortcutCheckPromises.length > 0) {
    await Promise.all(shortcutCheckPromises);
  }

  if (newlyDiscoveredMigrated.length > 0) {
    recordDriveMigrationStats(newlyDiscoveredMigrated);
  }

  // 4. 生成统一的状态映射字典供前端即时恢复
  const knownItemStates: Record<
    string,
    { status: "pending" | "migrating" | "migrated" | "skipped" | "failed"; wikiToken?: string; url?: string }
  > = {};

  for (const f of files) {
    if (f.status && f.status !== "pending") {
      const stateObj = {
        status: f.status,
        wikiToken: f.wikiToken,
        url: f.wikiUrl,
      };
      knownItemStates[f.token] = stateObj;
      if (f.targetToken) knownItemStates[f.targetToken] = stateObj;
      if (f.shortcutToken) knownItemStates[f.shortcutToken] = stateObj;
    }
  }

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
    knownItemStates,
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
 * 解析并轮询 moveDocsToWiki 的结果，获取 wiki_token
 */
async function resolveMovedWikiToken(
  client: any,
  res: any,
  realToken: string,
  realType: string,
): Promise<string | undefined> {
  if (res.data?.wiki_token) {
    return res.data.wiki_token;
  }

  // 如果返回了异步 task_id，轮询任务结果（最多 15 秒）
  if (res.data?.task_id) {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const taskRes = await client.wiki.task.get({
          path: { task_id: res.data.task_id },
          params: { task_type: "move" },
        });
        if (taskRes.code === 0 && taskRes.data?.task) {
          const taskObj = taskRes.data.task;
          const nodeToken =
            taskObj.move_result?.[0]?.node?.node_token ||
            taskObj.move_result?.[0]?.node?.wiki_token ||
            (taskObj as any).node_token;
          if (nodeToken) return nodeToken;
        }
      } catch {
        // ignore error during polling
      }
    }
  }

  // 降级探测：通过 getNode 查找该文档是否已成功挂载入知识库
  try {
    const nodeRes = await client.wiki.space.getNode({
      params: {
        token: realToken,
        obj_type: realType,
      },
    });
    if (nodeRes.code === 0 && nodeRes.data?.node) {
      return nodeRes.data.node.node_token || nodeRes.data.node.wiki_token;
    }
  } catch {
    // ignore
  }

  return undefined;
}

/**
 * 批量迁移文件至飞书知识库
 */
export async function executeBatchMigration(input: {
  targetWikiUrl: string;
  targetParentNodeToken: string;
  items: MigrateItemParam[];
  sourceFolderUrl?: string;
  sourceFolderToken?: string;
  sourceFolderName?: string;
}): Promise<BatchMigrateResponse> {
  const client = getFeishuClient();
  const wikiInfo = await fetchWikiDirectories(input.targetWikiUrl);
  const spaceId = wikiInfo.spaceId;

  const defaultParentToken = input.targetParentNodeToken || wikiInfo.rootToken;
  const limit = pLimit(2); // 限制并发，避免触发飞书频控

  const results: MigrateSingleResult[] = await Promise.all(
    input.items.map((item) =>
      limit(async (): Promise<MigrateSingleResult> => {
        const parentToken = item.customTargetParentToken || defaultParentToken;
        const realToken = item.targetToken || item.token;
        const realType = item.targetType || item.type;
        const objType = normalizeObjType(realType);

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
              obj_token: realToken,
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

          const wikiToken = await resolveMovedWikiToken(client, res, realToken, objType);
          const url = wikiToken ? `${wikiInfo.origin}/wiki/${wikiToken}` : undefined;

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

  // 记录迁移统计数据（同时记录 item.token 和 realToken）
  const statsToRecord: MigratedFileRecord[] = [];
  results.forEach((r, idx) => {
    const origItem = input.items[idx];
    const realToken = origItem?.targetToken || r.token;
    statsToRecord.push({
      fileToken: realToken,
      fileName: r.name,
      fileType: r.type,
      sourceDriveToken: input.sourceFolderToken || "default_personal_drive",
      sourceDriveUrl: input.sourceFolderUrl,
      sourceDriveName: input.sourceFolderName || "个人网盘",
      targetWikiUrl: input.targetWikiUrl,
      targetParentNodeToken: input.targetParentNodeToken,
      wikiToken: r.wikiToken,
      wikiUrl: r.url,
      migratedAt: new Date().toISOString(),
      status: r.status,
      error: r.error,
    });
    if (realToken !== r.token) {
      statsToRecord.push({
        fileToken: r.token,
        fileName: r.name,
        fileType: r.type,
        sourceDriveToken: input.sourceFolderToken || "default_personal_drive",
        sourceDriveUrl: input.sourceFolderUrl,
        sourceDriveName: input.sourceFolderName || "个人网盘",
        targetWikiUrl: input.targetWikiUrl,
        targetParentNodeToken: input.targetParentNodeToken,
        wikiToken: r.wikiToken,
        wikiUrl: r.url,
        migratedAt: new Date().toISOString(),
        status: r.status,
        error: r.error,
      });
    }
  });

  recordDriveMigrationStats(statsToRecord);

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
        const realToken = item.targetToken || item.token;
        const realType = item.targetType || item.type;
        const objType = normalizeObjType(realType);

        updateDriveMigrationTaskItem(taskId, item.token, { status: "migrating" });
        updateDriveMigrationTask(taskId, { currentFile: item.name });

        if (item.type === "folder") {
          updateDriveMigrationTaskItem(taskId, item.token, {
            status: "skipped",
            error: "文件夹暂不直接迁移，请直接迁移文件夹内的具体文档",
          });
          recordDriveMigrationStats([
            {
              fileToken: item.token,
              fileName: item.name,
              fileType: item.type,
              sourceDriveToken: task.sourceFolderToken || "default_personal_drive",
              sourceDriveUrl: task.sourceFolderUrl,
              sourceDriveName: task.sourceFolderName || "个人网盘",
              targetWikiUrl: task.targetWikiUrl,
              targetParentNodeToken: parentToken,
              migratedAt: new Date().toISOString(),
              status: "skipped",
              error: "文件夹暂不直接迁移，请直接迁移文件夹内的具体文档",
              taskId: task.id,
            },
          ]);
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
              obj_token: realToken,
              apply: true,
            },
          });

          if (res.code !== 0) {
            const errorMsg = formatLarkError(res, "迁移至知识库失败");
            updateDriveMigrationTaskItem(taskId, item.token, {
              status: "failed",
              error: errorMsg,
            });
            recordDriveMigrationStats([
              {
                fileToken: realToken,
                fileName: item.name,
                fileType: item.type,
                sourceDriveToken: task.sourceFolderToken || "default_personal_drive",
                sourceDriveUrl: task.sourceFolderUrl,
                sourceDriveName: task.sourceFolderName || "个人网盘",
                targetWikiUrl: task.targetWikiUrl,
                targetParentNodeToken: parentToken,
                migratedAt: new Date().toISOString(),
                status: "failed",
                error: errorMsg,
                taskId: task.id,
              },
            ]);
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

          const wikiToken = await resolveMovedWikiToken(client, res, realToken, objType);
          const url = wikiToken ? `${origin}/wiki/${wikiToken}` : undefined;

          updateDriveMigrationTaskItem(taskId, item.token, {
            status: "success",
            wikiToken,
            url,
          });

          const statRecords: MigratedFileRecord[] = [
            {
              fileToken: realToken,
              fileName: item.name,
              fileType: item.type,
              sourceDriveToken: task.sourceFolderToken || "default_personal_drive",
              sourceDriveUrl: task.sourceFolderUrl,
              sourceDriveName: task.sourceFolderName || "个人网盘",
              targetWikiUrl: task.targetWikiUrl,
              targetParentNodeToken: parentToken,
              wikiToken,
              wikiUrl: url,
              migratedAt: new Date().toISOString(),
              status: "success",
              taskId: task.id,
            },
          ];
          if (item.token !== realToken) {
            statRecords.push({
              fileToken: item.token,
              fileName: item.name,
              fileType: item.type,
              sourceDriveToken: task.sourceFolderToken || "default_personal_drive",
              sourceDriveUrl: task.sourceFolderUrl,
              sourceDriveName: task.sourceFolderName || "个人网盘",
              targetWikiUrl: task.targetWikiUrl,
              targetParentNodeToken: parentToken,
              wikiToken,
              wikiUrl: url,
              migratedAt: new Date().toISOString(),
              status: "success",
              taskId: task.id,
            });
          }
          recordDriveMigrationStats(statRecords);

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
          recordDriveMigrationStats([
            {
              fileToken: realToken,
              fileName: item.name,
              fileType: item.type,
              sourceDriveToken: task.sourceFolderToken || "default_personal_drive",
              sourceDriveUrl: task.sourceFolderUrl,
              sourceDriveName: task.sourceFolderName || "个人网盘",
              targetWikiUrl: task.targetWikiUrl,
              targetParentNodeToken: parentToken,
              migratedAt: new Date().toISOString(),
              status: "failed",
              error: errorMsg,
              taskId: task.id,
            },
          ]);
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
