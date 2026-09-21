import { NextResponse } from "next/server";
import { getPublicBots, getRecentTasks, getSchedules } from "@/lib/core/store";
import { upcomingTasks } from "@/lib/core/scheduler";


export async function GET() {
  const schedules = getSchedules();
  return NextResponse.json({
    schedules,
    bots: getPublicBots(),
    tasks: await upcomingTasks(50),
    history: getRecentTasks(),
    configured: getPublicBots().some((bot) => bot.configured && bot.enabled),
  });
}
