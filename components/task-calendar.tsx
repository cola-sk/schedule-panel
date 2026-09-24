"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReminderTask } from "@/lib/core/types";

type CalendarHoliday = { date: string; name: string };
type CalendarView = "month" | "week";

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function dateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00+08:00`);
}

function keyFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(key: string, amount: number): string {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromDate(date);
}

function monthKey(key: string): string {
  return key.slice(0, 7);
}

function startOfWeek(key: string): string {
  const day = dateFromKey(key).getUTCDay() || 7;
  return addDays(key, 1 - day);
}

function formatMonth(key: string): string {
  const date = dateFromKey(key);
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long" }).format(date);
}

function formatRange(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "short", day: "numeric" });
  return `${formatter.format(dateFromKey(start))} – ${formatter.format(dateFromKey(end))}`;
}

function taskTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function taskDate(value: string): string {
  return keyFromDate(new Date(value));
}

function dayNumber(key: string): string {
  return key.slice(-2).replace(/^0/, "");
}

export function TaskCalendar({
  onOpenSchedule,
  onPostponeTask,
  refreshToken,
}: {
  onOpenSchedule: (scheduleId: string) => void;
  onPostponeTask: (task: ReminderTask) => void;
  refreshToken: number;
}) {
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => keyFromDate(new Date()));
  const [tasks, setTasks] = useState<ReminderTask[]>([]);
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const days = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    const firstWeekday = dateFromKey(first).getUTCDay() || 7;
    const last = keyFromDate(new Date(Date.UTC(year, month, 0, 4)));
    const lastWeekday = dateFromKey(last).getUTCDay() || 7;
    const gridStart = addDays(first, 1 - firstWeekday);
    const gridEnd = addDays(last, 7 - lastWeekday);
    const total = Math.round((dateFromKey(gridEnd).getTime() - dateFromKey(gridStart).getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return Array.from({ length: total }, (_, index) => addDays(gridStart, index));
  }, [cursor, view]);

  const rangeStart = days[0];
  const rangeEnd = days.at(-1);

  useEffect(() => {
    if (!rangeStart || !rangeEnd) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    fetch(`/api/calendar?start=${rangeStart}&end=${rangeEnd}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "日历加载失败");
        setTasks(result.tasks ?? []);
        setHolidays(result.holidays ?? []);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "日历加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [rangeStart, rangeEnd, refreshToken]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, ReminderTask[]>();
    tasks.forEach((task) => {
      const key = taskDate(task.scheduledAt);
      map.set(key, [...(map.get(key) ?? []), task]);
    });
    return map;
  }, [tasks]);

  const holidaysByDate = useMemo(() => new Map(holidays.map((holiday) => [holiday.date, holiday.name])), [holidays]);
  const today = keyFromDate(new Date());
  const title = view === "month" ? formatMonth(cursor) : formatRange(days[0], days[6]);

  function movePeriod(amount: number) {
    if (view === "week") setCursor(addDays(startOfWeek(cursor), amount * 7));
    else {
      const date = dateFromKey(`${monthKey(cursor)}-01`);
      date.setUTCMonth(date.getUTCMonth() + amount);
      setCursor(keyFromDate(date));
    }
  }

  function goToday() {
    setCursor(today);
  }

  function isKnowledgeMigrationTask(task: ReminderTask) {
    return task.scheduleId.startsWith("knowledge-migration:");
  }

  function openTask(task: ReminderTask) {
    if (isKnowledgeMigrationTask(task)) {
      const taskId = task.scheduleId.replace("knowledge-migration:", "");
      window.location.assign(`/knowledge-migration?taskId=${taskId}`);
      return;
    }
    onOpenSchedule(task.scheduleId);
  }

  return (
    <CardShell>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">任务日历</h2>
          <Badge variant="outline" className="ml-1 text-[11px]">中国节假日</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(["month", "week"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${view === item ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setView(item)}
              >
                {item === "month" ? "月" : "周"}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={goToday}>今天</Button>
          <Button variant="ghost" size="sm" className="size-8 px-0" onClick={() => movePeriod(-1)} aria-label="上一个周期"><ChevronLeft className="size-4" /></Button>
          <Button variant="ghost" size="sm" className="size-8 px-0" onClick={() => movePeriod(1)} aria-label="下一个周期"><ChevronRight className="size-4" /></Button>
        </div>
      </div>
      <div className="px-5 py-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">{title}</p>
          {loading && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />加载中</span>}
        </div>
        {error ? <p className="py-10 text-center text-sm text-red-600">{error}</p> : (
          <div className="overflow-x-auto">
            <div className={`min-w-[720px] ${view === "month" ? "grid grid-cols-7" : "grid grid-cols-7"}`}>
              {weekdayLabels.map((label) => <div key={label} className="border-b border-border px-2 py-2 text-center text-xs font-medium text-muted-foreground">{label}</div>)}
              {days.map((day) => {
                const dayTasks = tasksByDate.get(day) ?? [];
                const holiday = holidaysByDate.get(day);
                const inMonth = monthKey(day) === monthKey(cursor);
                return (
                  <div key={day} className={`min-h-28 border-b border-r border-border p-2 ${inMonth || view === "week" ? "" : "bg-secondary/20"} ${holiday ? "bg-red-50/70" : ""}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className={`grid size-6 place-items-center rounded-full text-xs ${day === today ? "bg-foreground font-semibold text-background" : inMonth || view === "week" ? "text-foreground" : "text-muted-foreground/50"}`}>{dayNumber(day)}</span>
                      {holiday && <span className="max-w-[7rem] truncate text-[10px] font-medium text-red-600" title={holiday}>{holiday}</span>}
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {dayTasks.map((task) => (
                        <div
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          className={`group cursor-pointer rounded border px-1.5 py-1 text-[11px] leading-4 shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                            task.status === "postponed"
                              ? "border-dashed border-border/80 bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
                              : "border-border/80 bg-card hover:border-foreground/30 hover:bg-secondary/40"
                          }`}
                          title={`${task.scheduleName} · ${isKnowledgeMigrationTask(task) ? "知识库统计通知" : task.host.name}，点击查看详情`}
                          onClick={() => openTask(task)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openTask(task);
                            }
                          }}
                        >
                          <div className="truncate font-medium">{task.scheduleName}</div>
                          <div className="truncate text-muted-foreground">
                            {isKnowledgeMigrationTask(task)
                              ? `${taskTime(task.scheduledAt)} · 知识库统计`
                              : task.status === "postponed"
                              ? "本期已延期"
                              : task.host.name === "系统自动" || task.scheduleId.includes("weekly-report")
                              ? `${taskTime(task.scheduledAt)} · 自动归档`
                              : `${taskTime(task.scheduledAt)} · ${task.host.name}`}
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-1">
                            <span className="text-[10px] text-muted-foreground group-hover:text-foreground">查看详情</span>
                            {isKnowledgeMigrationTask(task) ? (
                              <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal text-indigo-600">
                                归档周报
                              </Badge>
                            ) : task.status === "sent" ? (
                              <Badge variant="success" className="px-1 py-0 text-[9px] font-normal">
                                已发送
                              </Badge>
                            ) : task.status === "postponed" ? (
                              <Badge variant="secondary" className="px-1 py-0 text-[9px] font-normal">
                                已延期
                              </Badge>
                            ) : new Date(task.scheduledAt).getTime() >= Date.now() ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onPostponeTask(task);
                                }}
                                aria-label={`延期${task.scheduleName}`}
                              >
                                <CalendarPlus className="size-3" />
                                延期
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </CardShell>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return <section className="mb-8 overflow-hidden rounded-xl border border-border bg-card shadow-xs">{children}</section>;
}
