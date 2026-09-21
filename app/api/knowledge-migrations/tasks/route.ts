import { NextResponse } from "next/server";
import { createTask, getPublicTaskConfig, getTasks } from "@/lib/knowledge-migration/store";
import { getTaskOverview } from "@/lib/knowledge-migration/service";
import type { ConfluenceAuthType } from "@/lib/knowledge-migration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  try {
    const tasks = getTasks() || [];
    return NextResponse.json({
      tasks: (tasks || []).map((task) => ({
        id: task.id,
        name: task.name,
        description: task.description,
        config: getPublicTaskConfig(task),
        overview: getTaskOverview(task.id),
        treeNodeCount: task.tree?.length || 0,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/knowledge-migrations/tasks 失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取任务列表失败", tasks: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = text(body.name) || "新归档任务";
    const description = text(body.description);
    const confluenceBaseUrl = text(body.confluenceBaseUrl);
    const confluenceRootPageId = text(body.confluenceRootPageId);
    const targetWikiRoot = text(body.targetWikiRoot);
    const confluenceAuthType = (text(body.confluenceAuthType) || "pat") as ConfluenceAuthType;
    const confluenceUsername = text(body.confluenceUsername);
    let confluenceSecret = text(body.confluenceSecret);
    const defaultOperatorName = text(body.defaultOperatorName);

    if (!confluenceBaseUrl || !confluenceRootPageId || !targetWikiRoot) {
      throw new Error("请填写 Confluence 地址、待迁移页面节点 ID 和飞书知识库根节点 URL");
    }

    try {
      new URL(confluenceBaseUrl);
      new URL(targetWikiRoot);
    } catch {
      throw new Error("Confluence 地址和飞书知识库根节点必须是有效 URL");
    }

    // 若未填凭据，优先尝试继承同站点或已有任务中配置过的凭据
    if (!confluenceSecret) {
      const existingTasks = getTasks();
      const matched =
        existingTasks.find((t) => t.config?.confluenceSecret && t.config?.confluenceBaseUrl === confluenceBaseUrl) ||
        existingTasks.find((t) => t.config?.confluenceSecret);
      if (matched?.config?.confluenceSecret) {
        confluenceSecret = matched.config.confluenceSecret;
      }
    }

    const task = createTask({
      name,
      description: description || undefined,
      config: {
        confluenceBaseUrl,
        confluenceRootPageId,
        confluenceAuthType,
        confluenceUsername: confluenceUsername || undefined,
        confluenceSecret: confluenceSecret || undefined,
        targetWikiRoot,
        defaultOperatorName,
      },
    });

    return NextResponse.json({
      task: {
        id: task.id,
        name: task.name,
        description: task.description,
        config: getPublicTaskConfig(task),
        overview: getTaskOverview(task.id),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建任务失败" }, { status: 400 });
  }
}
