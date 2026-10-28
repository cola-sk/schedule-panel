import { NextRequest, NextResponse } from "next/server";
import { getTask, saveTaskNotifyConfig } from "@/lib/knowledge-migration/store";
import {
  getTaskMemberContributionStatus,
  updateMemberPersonalMigrationStatus,
  batchUpdateMemberPersonalMigrationStatus,
} from "@/lib/knowledge-migration/personal-migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: 获取任务下所有成员的个人文档迁移完成状态、历史贡献及 0 贡献催办名单
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const data = getTaskMemberContributionStatus(taskId);
    return NextResponse.json({
      taskId,
      taskName: task.name,
      ...data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "获取成员个人迁移状态失败" },
      { status: 500 },
    );
  }
}

/**
 * PATCH: 更新成员个人文档迁移状态或 0 贡献 @ 催办配置
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const body = await request.json();

    // 1. 批量更新个人迁移状态
    if (Array.isArray(body.batch)) {
      batchUpdateMemberPersonalMigrationStatus(taskId, body.batch);
    }
    // 2. 单个更新个人迁移状态
    else if (body.memberId !== undefined || body.name !== undefined) {
      const idOrName = body.memberId || body.name;
      updateMemberPersonalMigrationStatus(taskId, idOrName, Boolean(body.completed), body.note);
    }

    // 3. 更新 @ 催办配置
    if (
      body.atIncompleteMembers !== undefined ||
      body.atZeroContributors !== undefined ||
      body.atIncompleteMode !== undefined ||
      body.incompleteNoticeMessage !== undefined ||
      body.zeroNoticeMessage !== undefined
    ) {
      const prevNotify = task.notifyConfig || {
        enabled: false,
        dayOfWeek: 5,
        time: "18:00",
      };
      const isAtIncomplete =
        body.atIncompleteMembers !== undefined
          ? Boolean(body.atIncompleteMembers)
          : body.atZeroContributors !== undefined
          ? Boolean(body.atZeroContributors)
          : Boolean(prevNotify.atIncompleteMembers ?? prevNotify.atZeroContributors);

      const noticeMsg =
        body.incompleteNoticeMessage !== undefined
          ? body.incompleteNoticeMessage
          : body.zeroNoticeMessage !== undefined
          ? body.zeroNoticeMessage
          : (prevNotify.incompleteNoticeMessage || prevNotify.zeroNoticeMessage);

      saveTaskNotifyConfig(taskId, {
        ...prevNotify,
        atIncompleteMembers: isAtIncomplete,
        atZeroContributors: isAtIncomplete,
        atIncompleteMode: body.atIncompleteMode || prevNotify.atIncompleteMode || "all_incomplete",
        incompleteNoticeMessage: noticeMsg,
        zeroNoticeMessage: noticeMsg,
      });
    }

    const updatedData = getTaskMemberContributionStatus(taskId);
    return NextResponse.json({
      success: true,
      taskId,
      taskName: task.name,
      ...updatedData,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "更新成员迁移状态失败" },
      { status: 400 },
    );
  }
}
