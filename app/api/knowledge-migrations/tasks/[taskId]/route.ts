import { NextRequest, NextResponse } from "next/server";
import { deleteTask, getPublicTaskConfig, getTask, getTaskItem, getTaskItems, persistMigrationState, setActiveTask, updateTask } from "@/lib/knowledge-migration/store";
import { getTaskOverview } from "@/lib/knowledge-migration/service";
import { getNextMigrationStatsRunAt } from "@/lib/knowledge-migration/notifier";
import { getPage, isContentEmpty, refreshWikiTreeProgress } from "@/lib/knowledge-migration/confluence";
import { taxonomyFromDirectories, type ConfluenceAuthType, type ItemFilters } from "@/lib/knowledge-migration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    setActiveTask(taskId);

    const { searchParams } = new URL(request.url);
    const selectedWikiId = searchParams.get("selectedWikiId") || undefined;

    // 若选中国了特定页面，且该文档尚未检测过正文是否为空，则主动拉取一次 Confluence 正文检测并持久化
    if (selectedWikiId && selectedWikiId !== "all") {
      const selectedItem = getTaskItem(taskId, selectedWikiId);
      if (selectedItem?.source && selectedItem.source.contentEmpty === undefined) {
        try {
          const page = await getPage(task.config, selectedWikiId);
          const rawStorage = page.body?.storage?.value || "";
          selectedItem.source.contentEmpty = isContentEmpty(rawStorage);
          selectedItem.source.contentLength = rawStorage.length;
          persistMigrationState();
        } catch {
          // 容错处理：网络不可用时不阻塞详情返回
        }
      }
    }

    const filters: ItemFilters = {
      selectedWikiId,
      tab: (searchParams.get("tab") || undefined) as ItemFilters["tab"],
      status: (searchParams.get("status") || undefined) as ItemFilters["status"],
      primaryCategory: searchParams.get("primaryCategory") || undefined,
      secondaryCategory: searchParams.get("secondaryCategory") || undefined,
      keyword: searchParams.get("keyword") || undefined,
      createdBy: searchParams.get("createdBy") || undefined,
      updatedBy: searchParams.get("updatedBy") || undefined,
      approvedBy: searchParams.get("approvedBy") || undefined,
      jobId: searchParams.get("jobId") || undefined,
    };

    const items = getTaskItems(taskId, filters);
    const directories = task.targetDirectories || [];
    const taxonomy = taxonomyFromDirectories(directories);
    const currentNodeItem =
      selectedWikiId && selectedWikiId !== "all" ? getTaskItem(taskId, selectedWikiId) : undefined;

    return NextResponse.json({
      task: {
        id: task.id,
        name: task.name,
        description: task.description,
        config: getPublicTaskConfig(task),
        tree: refreshWikiTreeProgress(task.tree || [], task.items || {}),
        treeUpdatedAt: task.treeUpdatedAt,
        targetDirectories: directories,
        taxonomy,
        overview: getTaskOverview(task.id),
        notifySchedule: task.notifyConfig
          ? {
              enabled: task.notifyConfig.enabled,
              dayOfWeek: task.notifyConfig.dayOfWeek,
              time: task.notifyConfig.time,
              lastSentAt: task.notifyConfig.lastSentAt,
              cycleType: task.notifyConfig.cycleType,
              nextRunAt: getNextMigrationStatsRunAt(task.notifyConfig),
            }
          : undefined,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
      currentNodeItem,
      items,
    });
  } catch (error) {
    console.error("GET /api/knowledge-migrations/tasks/[taskId] 错误:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取任务详情失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const name = text(body.name);
    const description = body.description !== undefined ? text(body.description) : undefined;
    const confluenceBaseUrl = text(body.confluenceBaseUrl);
    const confluenceRootPageId = text(body.confluenceRootPageId);
    const targetWikiRoot = text(body.targetWikiRoot);
    const confluenceAuthType = text(body.confluenceAuthType) as ConfluenceAuthType;
    const confluenceUsername = body.confluenceUsername !== undefined ? text(body.confluenceUsername) : undefined;
    const confluenceSecret = body.confluenceSecret !== undefined ? text(body.confluenceSecret) : undefined;
    const defaultOperatorName = body.defaultOperatorName !== undefined ? text(body.defaultOperatorName) : undefined;

    if (confluenceBaseUrl) {
      try {
        new URL(confluenceBaseUrl);
      } catch {
        throw new Error("Confluence 地址不是有效 URL");
      }
    }
    if (targetWikiRoot) {
      try {
        new URL(targetWikiRoot);
      } catch {
        throw new Error("目标飞书知识库根节点不是有效 URL");
      }
    }

    const updated = updateTask(taskId, {
      name: name || undefined,
      description,
      config: {
        confluenceBaseUrl: confluenceBaseUrl || undefined,
        confluenceRootPageId: confluenceRootPageId || undefined,
        confluenceAuthType: confluenceAuthType || undefined,
        confluenceUsername,
        confluenceSecret: confluenceSecret || undefined,
        targetWikiRoot: targetWikiRoot || undefined,
        defaultOperatorName,
      },
    });

    if (!updated) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    return NextResponse.json({
      task: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        config: getPublicTaskConfig(updated),
        overview: getTaskOverview(updated.id),
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新任务配置失败" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params;
    const deleted = deleteTask(taskId);
    if (!deleted) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除任务失败" },
      { status: 500 }
    );
  }
}
