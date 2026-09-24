import { getBotDefinition } from "../bots/index";
import { getChineseHolidayDates } from "./holidays";
import { fetchRotationFromSource, sendWebhookMessage } from "./feishu-client";
import {
  getBot,
  getRecentTasks,
  getSchedule,
  getSchedules,
  recordTask,
  replaceRotation,
  updateSchedule,
} from "./store";
import { ReminderSchedule, ReminderTask, RotationMember } from "./types";

type TaskSendResult = {
  mocked: boolean;
  message?: string;
  botId: string;
  botName: string;
  content: string;
};

export const CATCHUP_WINDOW_MS = 60 * 60 * 1000;

function extractPayloadText(payload: Record<string, unknown>): string {
  const texts: string[] = [];

  function visit(value: unknown, key?: string) {
    if (typeof value === "string") {
      if (key === "text" || key === "title") texts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => {
        if (childKey !== "user_id" && childKey !== "tag") visit(childValue, childKey);
      });
    }
  }

  visit(payload);
  return [...new Set(texts)].join(" ").replace(/\s+/g, " ").trim();
}

export function atShanghaiLocal(date: Date, time: string): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${time}:00+08:00`);
}

export function chinaDateKey(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chinaWeekday(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  });
  const str = formatter.format(date);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[str] ?? 1;
}

function yearsAround(date: Date, weeks: number): number[] {
  const years = new Set<number>();
  for (let index = 0; index <= weeks; index += 1) {
    const candidate = new Date(date);
    candidate.setUTCDate(candidate.getUTCDate() + index * 7);
    years.add(Number(chinaDateKey(candidate).slice(0, 4)));
  }
  return [...years];
}

export function yearsForScheduling(date: Date, weeks: number): number[] {
  return [...yearsAround(date, weeks)];
}

/**
 * 构造针对特定时间与成员的任务对象
 */
export function taskForScheduleAt(schedule: ReminderSchedule, scheduledAt: Date): ReminderTask {
  const dateKey = chinaDateKey(scheduledAt);
  const overriddenHost = schedule.hostOverrides?.[dateKey];
  const baseIndex = typeof schedule.currentIndex === "number" ? schedule.currentIndex : 0;
  const defaultHost = schedule.rotation[baseIndex % schedule.rotation.length] || { name: "未知" };
  const host = overriddenHost || defaultHost;
  const isOverridden = Boolean(overriddenHost && (overriddenHost.name !== defaultHost.name || overriddenHost.openId !== defaultHost.openId));
  const isSwapped = Boolean(overriddenHost?.isSwapped);

  return {
    id: `${schedule.id}-${scheduledAt.toISOString()}`,
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    host,
    isOverridden,
    isSwapped,
    scheduledAt: scheduledAt.toISOString(),
    status: "pending",
  };
}

/**
 * 检查指定 Schedule 在某一日期是否已被有效发送
 */
export function isOccurrenceSent(scheduleId: string, scheduledAt: Date): boolean {
  const schedule = getSchedule(scheduleId);
  if (!schedule) return false;

  const targetDateKey = chinaDateKey(scheduledAt);
  // 如果 schedule.lastSentAt 记录的自然日正好是该目标日，说明本周期已发送
  if (schedule.lastSentAt && chinaDateKey(new Date(schedule.lastSentAt)) === targetDateKey) {
    return true;
  }

  const isoId = `${scheduleId}-${scheduledAt.toISOString()}`;
  return getRecentTasks().some(
    (task) =>
      task.scheduleId === scheduleId &&
      task.status === "sent" &&
      (task.id === isoId || (task.triggerType === "scheduled" && chinaDateKey(new Date(task.scheduledAt)) === targetDateKey)),
  );
}

/**
 * 获取自指定时间点起，下一个符合要求的定时执行时间点（跳过节假日、延期日期、已发周期）
 */
export function getNextAvailableOccurrenceDate(
  schedule: ReminderSchedule,
  now: Date,
  holidays: Set<string>,
  lookbackMs = 0,
): Date {
  const duration = 7 * 24 * 60 * 60 * 1000;
  const postponedDates = new Set(schedule.postponedDates ?? []);
  const todayShanghai = atShanghaiLocal(now, schedule.time);
  const currentWeekday = chinaWeekday(todayShanghai);

  // 计算当前自然周的目标执行时间点
  const daysDiff = schedule.dayOfWeek - currentWeekday;
  let candidate = new Date(todayShanghai.getTime() + daysDiff * 24 * 60 * 60 * 1000);

  // 判断当前自然周的目标时间点是否已经过去或已发送
  const candidateKey = chinaDateKey(candidate);
  const candidateTime = candidate.getTime();
  const lastSentKey = schedule.lastSentAt ? chinaDateKey(new Date(schedule.lastSentAt)) : "";
  const alreadySentThisPeriod = lastSentKey === candidateKey;
  const isPast = candidateTime < now.getTime() - lookbackMs;

  if (alreadySentThisPeriod || isPast) {
    candidate = new Date(candidate.getTime() + duration);
  }

  // 沿时间轴向前寻找第一个非节假日、未延期的有效执行日
  let guard = 0;
  while (guard < 1000) {
    guard += 1;
    const dateKey = chinaDateKey(candidate);
    if (!holidays.has(dateKey) && !postponedDates.has(dateKey)) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + duration);
  }

  return candidate;
}

/**
 * 推算指定 Schedule 未来的待执行任务列表（基于显式 currentIndex 游标推进与 hostOverrides 临时覆盖）
 */
export async function upcomingTasksForSchedule(
  schedule: ReminderSchedule,
  limit: number,
  now: Date,
  holidays: Set<string>,
  lookbackMs = 0,
): Promise<ReminderTask[]> {
  if (!schedule.enabled) return [];
  const rotation = schedule.rotation && schedule.rotation.length > 0 ? schedule.rotation : [{ name: "系统自动" }];

  const duration = 7 * 24 * 60 * 60 * 1000;
  const postponedDates = new Set(schedule.postponedDates ?? []);
  const todayKey = chinaDateKey(now);
  // 过滤掉早于今天的历史过期 overrides
  const hostOverrides = Object.fromEntries(
    Object.entries(schedule.hostOverrides ?? {}).filter(([dateKey]) => dateKey >= todayKey),
  );
  const startCandidate = getNextAvailableOccurrenceDate(schedule, now, holidays, lookbackMs);

  const tasks: ReminderTask[] = [];
  let candidate = startCandidate;
  let offset = 0;
  let guard = 0;
  const baseIndex = typeof schedule.currentIndex === "number" ? schedule.currentIndex : 0;

  while (tasks.length < limit && guard < 10000) {
    guard += 1;
    const dateKey = chinaDateKey(candidate);
    if (!holidays.has(dateKey) && !postponedDates.has(dateKey)) {
      const memberIndex =
        (((baseIndex + offset) % rotation.length) + rotation.length) % rotation.length;
      const defaultHost = rotation[memberIndex];
      const overriddenHost = hostOverrides[dateKey];
      const host = overriddenHost || defaultHost;
      const isOverridden = Boolean(overriddenHost && (overriddenHost.name !== defaultHost?.name || overriddenHost.openId !== defaultHost?.openId));
      const isSwapped = Boolean(overriddenHost?.isSwapped);

      tasks.push({
        id: `${schedule.id}-${candidate.toISOString()}`,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        host,
        isOverridden,
        isSwapped,
        scheduledAt: candidate.toISOString(),
        status: "pending",
      });
      offset += 1;
    }
    candidate = new Date(candidate.getTime() + duration);
  }

  return tasks;
}

/**
 * 推算所有启用 Schedule 的未来待执行任务计划
 */
export async function upcomingTasks(limit = 12, now = new Date()): Promise<ReminderTask[]> {
  const holidays = await getChineseHolidayDates(yearsForScheduling(now, limit * 2 + 20));
  const tasks = (
    await Promise.all(
      getSchedules().map((schedule) => upcomingTasksForSchedule(schedule, limit, now, holidays, CATCHUP_WINDOW_MS)),
    )
  ).flat();

  return tasks.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, limit);
}

/**
 * 生成指定日期范围内的任务，供日历查看历史与未来安排
 */
export async function tasksBetween(start: Date, end: Date): Promise<ReminderTask[]> {
  if (start.getTime() > end.getTime()) return [];

  const startKey = chinaDateKey(start);
  const endKey = chinaDateKey(end);
  const schedules = getSchedules().filter((schedule) => schedule.enabled);
  if (schedules.length === 0) return [];

  const years: number[] = [];
  for (let year = Number(startKey.slice(0, 4)); year <= Number(endKey.slice(0, 4)); year += 1) {
    years.push(year);
  }
  const holidays = await getChineseHolidayDates(years);
  const tasks: ReminderTask[] = [];
  const now = new Date();

  for (const schedule of schedules) {
    // 1. 被延期的周期（展示为已延期卡片）
    const postponedSet = new Set(schedule.postponedDates ?? []);
    postponedSet.forEach((dateKey) => {
      if (dateKey >= startKey && dateKey <= endKey) {
        const fakeDate = new Date(`${dateKey}T${schedule.time}:00+08:00`);
        tasks.push({
          id: `${schedule.id}-${fakeDate.toISOString()}-postponed`,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          host: { name: "已延期" },
          scheduledAt: fakeDate.toISOString(),
          status: "postponed",
        });
      }
    });

    // 2. 定时任务排期推算（仅展示基于定时规则生成的排期任务，不包含手动执行历史）
    const projected = await upcomingTasksForSchedule(schedule, 50, now, holidays, CATCHUP_WINDOW_MS);
    projected.forEach((task) => {
      const taskDateKey = chinaDateKey(new Date(task.scheduledAt));
      if (taskDateKey >= startKey && taskDateKey <= endKey && !postponedSet.has(taskDateKey)) {
        tasks.push(task);
      }
    });
  }

  return tasks.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/**
 * 查找当前时刻到期需要触发派发的任务
 */
export async function dueTasks(now = new Date(), maxCatchupHours = 1): Promise<ReminderTask[]> {
  const holidays = await getChineseHolidayDates(yearsForScheduling(now, 20));
  const tasks = await Promise.all(
    getSchedules().map(async (schedule) => {
      if (!schedule.enabled) return [];
      const firstPending = (
        await upcomingTasksForSchedule(schedule, 1, now, holidays, maxCatchupHours * 3600_000)
      )[0];
      if (!firstPending) return [];
      const scheduledTime = new Date(firstPending.scheduledAt).getTime();
      const nowTime = now.getTime();
      if (scheduledTime <= nowTime && nowTime - scheduledTime <= maxCatchupHours * 3600_000) {
        return [firstPending];
      }
      return [];
    }),
  );
  return tasks.flat();
}

/**
 * 派发指定任务的消息提醒或执行任务
 */
export async function sendTaskReminder(
  task: ReminderTask,
): Promise<TaskSendResult> {
  const schedule = getSchedule(task.scheduleId);
  if (!schedule) throw new Error(`未找到定时规则: ${task.scheduleId}`);

  const bot = getBot(schedule.botId);
  const botDef = getBotDefinition(schedule.botId) || getBotDefinition(bot?.id || "") || getBotDefinition("febot");

  // 1. 如果该任务定义了专属执行器（如周报自动拉取归档）
  if (botDef?.executeTask) {
    const execResult = await botDef.executeTask({
      schedule,
      task,
      bot,
      scheduledAt: task.scheduledAt,
    });
    return {
      mocked: execResult.mocked,
      message: execResult.message,
      botId: execResult.botId ?? bot?.id ?? schedule.botId,
      botName: execResult.botName ?? bot?.name ?? "周报任务",
      content: execResult.content,
    };
  }

  // 2. 默认群提醒 Webhook 流程
  if (!bot?.enabled || !bot.webhookUrl) {
    return {
      mocked: true,
      message: "未配置有效 Webhook，已在本地模拟发送。",
      botId: bot?.id ?? schedule.botId,
      botName: bot?.name ?? "未配置机器人",
      content: "未配置有效 Webhook，已在本地模拟发送。",
    };
  }

  if (!botDef || !botDef.buildMessage) throw new Error(`未找到机器人业务模版: ${bot.id}`);

  const payload = await botDef.buildMessage({
    host: task.host,
    schedule,
    bot,
    scheduledAt: task.scheduledAt,
  });

  await sendWebhookMessage(bot.webhookUrl, payload);
  return {
    mocked: false,
    botId: bot.id,
    botName: bot.name,
    content: extractPayloadText(payload as unknown as Record<string, unknown>) || `提醒 ${task.host.name}`,
  };
}

/**
 * 定时轮询派发主入口（供 Cron 调用）
 */
export async function dispatchDueTasks(): Promise<Array<{ id: string; status: "sent" | "failed"; error?: string }>> {
  const sent: Array<{ id: string; status: "sent" | "failed"; error?: string }> = [];

  for (const task of await dueTasks()) {
    // 避免重复发送
    if (isOccurrenceSent(task.scheduleId, new Date(task.scheduledAt))) continue;

    const schedule = getSchedule(task.scheduleId);
    try {
      const result = await sendTaskReminder(task);
      const completed = recordTask({
        ...task,
        status: "sent",
        triggerType: "scheduled",
        sentAt: new Date().toISOString(),
        botId: result.botId,
        botName: result.botName,
        content: result.content,
      });
      if (schedule) {
        const rotationLen = schedule.rotation && schedule.rotation.length > 0 ? schedule.rotation.length : 1;
        const nextIndex = (schedule.currentIndex + 1) % rotationLen;
        const targetDateKey = chinaDateKey(new Date(task.scheduledAt));
        let nextOverrides = schedule.hostOverrides;
        if (nextOverrides && nextOverrides[targetDateKey]) {
          const { [targetDateKey]: _removed, ...rest } = nextOverrides;
          nextOverrides = rest;
        }
        updateSchedule(schedule.id, {
          lastSentAt: completed.sentAt,
          currentIndex: nextIndex,
          hostOverrides: nextOverrides,
        });
      }
      sent.push({ id: task.id, status: "sent" });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "发送失败";
      recordTask({
        ...task,
        status: "failed",
        triggerType: "scheduled",
        sentAt: new Date().toISOString(),
        error: errMsg,
        botId: schedule?.botId,
        botName: schedule ? getBot(schedule.botId)?.name : undefined,
        content: `执行失败：${errMsg}`,
      });
      sent.push({ id: task.id, status: "failed", error: errMsg });
    }
  }

  return sent;
}

/**
 * 同步指定 Schedule 绑定的飞书名单
 */
export async function syncScheduleRotation(scheduleId: string): Promise<RotationMember[]> {
  const schedule = getSchedule(scheduleId);
  if (!schedule) throw new Error(`未找到定时任务: ${scheduleId}`);
  if (!schedule.documentId) throw new Error("未配置飞书数据源地址（FEISHU_DOCUMENT_ID）");

  const botDef = getBotDefinition(schedule.botId);
  let rotation: RotationMember[];

  if (botDef?.customFetchRotation) {
    rotation = await botDef.customFetchRotation(schedule.documentId);
  } else {
    rotation = await fetchRotationFromSource(schedule.documentId);
  }

  // 同步新名单时，尽量保持当前值班人姓名对应的索引
  const currentHostName = schedule.rotation[schedule.currentIndex]?.name;
  let newIndex = 0;
  if (currentHostName) {
    const found = rotation.findIndex((m) => m.name === currentHostName);
    if (found >= 0) newIndex = found;
  }

  replaceRotation(schedule.id, rotation);
  updateSchedule(schedule.id, { currentIndex: newIndex, hostOverrides: {}, lastSentAt: undefined });
  return rotation;
}

/**
 * 获取指定 Schedule 当前即将执行任务的值班人员索引
 */
export async function getNextHostIndex(scheduleId: string): Promise<number> {
  const schedule = getSchedule(scheduleId);
  if (!schedule || !schedule.rotation || schedule.rotation.length === 0) return 0;
  return typeof schedule.currentIndex === "number" ? schedule.currentIndex % schedule.rotation.length : 0;
}

/**
 * 动态调整指定 Schedule 的当前值班人员节点（同时重置所有临时覆盖与已发送标记，从该节点重新开始）
 * @param scheduleId 定时任务 ID
 * @param targetIndex 目标成员在 rotation 名单中的索引
 */
export async function setCurrentHost(scheduleId: string, targetIndex: number): Promise<ReminderSchedule> {
  const schedule = getSchedule(scheduleId);
  if (!schedule) throw new Error(`未找到定时任务: ${scheduleId}`);
  if (!schedule.rotation || schedule.rotation.length === 0) {
    throw new Error("当前任务名单为空，无法设置值班节点");
  }
  if (targetIndex < 0 || targetIndex >= schedule.rotation.length) {
    throw new Error("目标值班人索引超出范围");
  }

  const updated = updateSchedule(schedule.id, { currentIndex: targetIndex, hostOverrides: {}, lastSentAt: undefined });
  if (!updated) throw new Error("更新定时任务失败");
  return updated;
}
