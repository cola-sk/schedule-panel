import { NextResponse } from "next/server";
import {
  getRosterConfig,
  getRosterMembers,
  saveRosterConfig,
  upsertRosterMember,
  deleteRosterMember,
} from "@/lib/roster/store";
import { syncRoster, sendTestAtNotification } from "@/lib/roster/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRosterConfig();
  const members = getRosterMembers();

  return NextResponse.json({
    config,
    members,
    stats: {
      total: members.length,
      resolved: members.filter((m) => Boolean(m.openId)).length,
      withEmail: members.filter((m) => Boolean(m.email)).length,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const action = body.action || "sync";

    if (action === "sync") {
      const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : undefined;
      const result = await syncRoster(sourceUrl);
      const config = getRosterConfig();
      return NextResponse.json({
        success: true,
        count: result.count,
        members: result.members,
        config,
      });
    }

    if (action === "saveConfig") {
      const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : undefined;
      if (!sourceUrl) {
        return NextResponse.json({ error: "飞书数据源 URL 不能为空" }, { status: 400 });
      }
      const config = saveRosterConfig({ sourceUrl });
      return NextResponse.json({ success: true, config });
    }

    if (action === "testAt") {
      const botId = typeof body.botId === "string" ? body.botId.trim() : "";
      const memberName = typeof body.memberName === "string" ? body.memberName.trim() : "";
      const customMessage = typeof body.customMessage === "string" ? body.customMessage.trim() : undefined;

      if (!botId) {
        return NextResponse.json({ error: "请选择接收测试消息的机器人" }, { status: 400 });
      }
      if (!memberName) {
        return NextResponse.json({ error: "请输入需要测试 @ 的成员姓名" }, { status: 400 });
      }

      const result = await sendTestAtNotification(botId, memberName, customMessage);
      return NextResponse.json(result);
    }

    if (action === "upsertMember") {
      const member = body.member;
      if (!member || typeof member !== "object" || !member.name?.trim()) {
        return NextResponse.json({ error: "成员姓名不能为空" }, { status: 400 });
      }
      const saved = upsertRosterMember(member);
      return NextResponse.json({ success: true, member: saved, members: getRosterMembers() });
    }

    if (action === "deleteMember") {
      const id = typeof body.id === "string" ? body.id.trim() : "";
      if (!id) {
        return NextResponse.json({ error: "缺少成员 ID" }, { status: 400 });
      }
      const deleted = deleteRosterMember(id);
      return NextResponse.json({ success: deleted, members: getRosterMembers() });
    }

    return NextResponse.json({ error: `不支持的操作类型: ${action}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "处理飞书名单设置请求失败" },
      { status: 400 },
    );
  }
}
