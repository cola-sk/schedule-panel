import { NextResponse } from "next/server";
import {
  getDriveMigrationTasks,
  createDriveMigrationTask,
  clearCompletedDriveMigrationTasks,
} from "@/lib/drive-migration/store";
import { startBackgroundMigrationTask } from "@/lib/drive-migration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tasks = getDriveMigrationTasks();
    return NextResponse.json({ tasks });
  } catch (error: any) {
    console.error("获取网盘迁移任务失败:", error);
    return NextResponse.json(
      { error: error?.message || "获取网盘迁移任务失败", tasks: [] },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      sourceFolderUrl,
      sourceFolderToken,
      sourceFolderName,
      targetWikiUrl,
      targetParentNodeToken,
      items,
    } = body;

    if (!targetWikiUrl || typeof targetWikiUrl !== "string") {
      return NextResponse.json({ error: "目标知识库链接无效" }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "未包含需要迁移的文档项" }, { status: 400 });
    }

    const { task, isNew } = createDriveMigrationTask({
      name,
      sourceFolderUrl: typeof sourceFolderUrl === "string" ? sourceFolderUrl.trim() : undefined,
      sourceFolderToken: typeof sourceFolderToken === "string" ? sourceFolderToken.trim() : undefined,
      sourceFolderName: typeof sourceFolderName === "string" ? sourceFolderName.trim() : undefined,
      targetWikiUrl: targetWikiUrl.trim(),
      targetParentNodeToken: targetParentNodeToken ? targetParentNodeToken.trim() : undefined,
      items,
    });

    // 只有新创建的任务才后台异步触发迁移，防止重复执行
    if (isNew) {
      void startBackgroundMigrationTask(task.id);
    }

    return NextResponse.json({ task, isNew });
  } catch (error: any) {
    console.error("创建网盘迁移任务失败:", error);
    return NextResponse.json(
      { error: error?.message || "创建网盘迁移任务失败" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    clearCompletedDriveMigrationTasks();
    const tasks = getDriveMigrationTasks();
    return NextResponse.json({ success: true, tasks });
  } catch (error: any) {
    console.error("清空网盘迁移任务失败:", error);
    return NextResponse.json(
      { error: error?.message || "清空网盘迁移任务失败" },
      { status: 500 },
    );
  }
}
