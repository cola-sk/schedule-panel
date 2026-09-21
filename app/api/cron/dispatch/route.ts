import { NextRequest, NextResponse } from "next/server";
import { dispatchDueTasks } from "@/lib/core/scheduler";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await dispatchDueTasks();
  return NextResponse.json({ checkedAt: new Date().toISOString(), tasks });
}

