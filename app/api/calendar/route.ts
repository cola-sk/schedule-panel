import { NextRequest, NextResponse } from "next/server";
import { getChineseHolidays } from "@/lib/core/holidays";
import { tasksBetween } from "@/lib/core/scheduler";
import { migrationStatsTasksBetween } from "@/lib/knowledge-migration/notifier";

function parseDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return null;
  const normalized = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return normalized === value ? date : null;
}

export async function GET(request: NextRequest) {
  const startValue = request.nextUrl.searchParams.get("start");
  const endValue = request.nextUrl.searchParams.get("end");
  const start = parseDate(startValue);
  const end = parseDate(endValue);

  if (!start || !end || start.getTime() > end.getTime()) {
    return NextResponse.json({ error: "请提供有效的 start 和 end 日期（YYYY-MM-DD）。" }, { status: 400 });
  }
  if (end.getTime() - start.getTime() > 93 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "单次最多查询 94 天。" }, { status: 400 });
  }

  const years = [];
  for (let year = Number(startValue!.slice(0, 4)); year <= Number(endValue!.slice(0, 4)); year += 1) years.push(year);
  // 先生成任务再读取假期，避免首次查询某个年份时并发写入同一份缓存。
  const scheduledTasks = await tasksBetween(start, end);
  const migrationTasks = migrationStatsTasksBetween(start, end);
  const tasks = [...scheduledTasks, ...migrationTasks].sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
  const holidays = await getChineseHolidays(years);
  return NextResponse.json({ tasks, holidays });
}
