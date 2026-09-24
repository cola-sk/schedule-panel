export interface WeekPeriodInfo {
  yearName: string; // e.g. "2026工作汇总"
  monthName: string; // e.g. "202609"
  weekTitle: string; // e.g. "2026-09-21~2026-09-25"
  monday: Date;
  friday: Date;
}

/**
 * 根据指定基准日期（上海时区）推算周报归档目录和标题。
 * 目录结构：年份工作汇总 / YYYYMM / YYYY-MM-DD~YYYY-MM-DD
 */
export function computeWeekPeriodInfo(dateInput: Date | string): WeekPeriodInfo {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const currentDayOfWeek = weekdayMap[parts.weekday] ?? 1;

  // 计算本周周一
  const mondayShanghai = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`);
  mondayShanghai.setDate(mondayShanghai.getDate() - (currentDayOfWeek - 1));

  // 计算本周周五
  const fridayShanghai = new Date(mondayShanghai);
  fridayShanghai.setDate(fridayShanghai.getDate() + 4);

  const monParts = Object.fromEntries(formatter.formatToParts(mondayShanghai).map((p) => [p.type, p.value]));
  const friParts = Object.fromEntries(formatter.formatToParts(fridayShanghai).map((p) => [p.type, p.value]));

  const monMonth = parseInt(monParts.month, 10);
  const monDay = parseInt(monParts.day, 10);
  const friMonth = parseInt(friParts.month, 10);
  const friDay = parseInt(friParts.day, 10);

  // 跨月周按周报结束日归档，确保 8 月 31 日～9 月 4 日进入 202609。
  const yearName = `${friParts.year}工作汇总`;
  const monthName = `${friParts.year}${friParts.month}`;
  const weekTitle = `${monParts.year}-${monParts.month}-${monParts.day}~${friParts.year}-${friParts.month}-${friParts.day}`;

  return {
    yearName,
    monthName,
    weekTitle,
    monday: mondayShanghai,
    friday: fridayShanghai,
  };
}
