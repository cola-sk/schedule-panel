import { NextResponse } from "next/server";
import {
  findMemberByName,
  findMemberByEmail,
  searchMembers,
  getEmailByName,
  getAtTagByName,
  getOpenIdByName,
} from "@/lib/roster/service";
import { getRosterMembers } from "@/lib/roster/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim();
  const email = searchParams.get("email")?.trim();
  const query = searchParams.get("q")?.trim() || searchParams.get("search")?.trim();
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  // 1. 按姓名查
  if (name) {
    const member = findMemberByName(name);
    return NextResponse.json({
      found: Boolean(member),
      name,
      email: member?.email || getEmailByName(name),
      openId: member?.openId || getOpenIdByName(name),
      atTag: member?.atTag || getAtTagByName(name),
      member: member || null,
    });
  }

  // 2. 按邮箱查
  if (email) {
    const member = findMemberByEmail(email);
    return NextResponse.json({
      found: Boolean(member),
      email,
      name: member?.name,
      openId: member?.openId,
      atTag: member?.atTag,
      member: member || null,
    });
  }

  // 3. 关键词检索（支持 @ 提及选择器与输入联想）
  if (query) {
    const matches = searchMembers(query, limit);
    return NextResponse.json({
      query,
      count: matches.length,
      members: matches,
    });
  }

  // 4. 返回全部名单
  const all = getRosterMembers();
  return NextResponse.json({
    count: all.length,
    members: all,
  });
}
