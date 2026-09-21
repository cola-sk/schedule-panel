import fs from "fs";
import path from "path";

export type ChineseHoliday = { date: string; name: string };

type HolidayCacheEntry = {
  source: "jiejiariapi";
  fetchedAt: string;
  holidays?: ChineseHoliday[];
  /** 兼容已有缓存；新数据统一写入 holidays。 */
  dates?: string[];
};

type HolidayCache = Record<string, HolidayCacheEntry>;

const CACHE_FILE = path.join(process.cwd(), "data", "chinese-holidays.json");

function readCache(): HolidayCache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as HolidayCache;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (error) {
    console.error("读取中国节假日缓存失败:", error);
  }
  return {};
}

function writeCache(cache: HolidayCache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tempFile = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(cache, null, 2), "utf-8");
    fs.renameSync(tempFile, CACHE_FILE);
  } catch (error) {
    console.error("保存中国节假日缓存失败:", error);
  }
}

/** 获取指定年份的中国法定公共假日（含连续假期每天的日期和名称）。 */
export async function getChineseHolidays(years: number[]): Promise<ChineseHoliday[]> {
  const cache = readCache();
  const holidays = new Map<string, string>();
  let changed = false;
  const now = new Date();
  const currentYear = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric" }).format(now),
  );

  for (const year of [...new Set(years)]) {
    const cached = cache[String(year)];
    let yearHolidays: ChineseHoliday[] = cached?.holidays ?? (cached?.dates ?? []).map((date) => ({ date, name: "法定节假日" }));

    // 已缓存的年份不再重复请求。下一年通常在前一年 11 月左右公布安排，
    // 在此之前不提前请求，避免把尚未发布的临时数据永久缓存下来。
    const canFetchFutureYear =
      year <= currentYear || now >= new Date(`${year - 1}-11-01T00:00:00+08:00`);
    if ((!yearHolidays.length || !cached?.holidays?.length || cached?.source !== "jiejiariapi") && canFetchFutureYear) {
      try {
        const response = await fetch(`https://api.jiejiariapi.com/v1/holidays/${year}`, {
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const holidayResponse = (await response.json()) as Record<string, { date?: string; name?: string; isOffDay?: boolean }>;
        yearHolidays = Object.values(holidayResponse)
          .filter((holiday) => holiday.date && holiday.isOffDay)
          .map((holiday) => ({ date: holiday.date as string, name: holiday.name || "法定节假日" }));
        if (yearHolidays.length > 0) {
          cache[String(year)] = { source: "jiejiariapi", fetchedAt: new Date().toISOString(), holidays: yearHolidays };
          changed = true;
        }
      } catch (error) {
        console.error(`获取 ${year} 年中国节假日失败，将使用已有缓存:`, error);
      }
    }

    yearHolidays.forEach((holiday) => holidays.set(holiday.date, holiday.name));
  }

  if (changed) writeCache(cache);
  return [...holidays.entries()].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}

/** 获取指定年份的中国法定公共假日日期（YYYY-MM-DD）。 */
export async function getChineseHolidayDates(years: number[]): Promise<Set<string>> {
  return new Set((await getChineseHolidays(years)).map((holiday) => holiday.date));
}
