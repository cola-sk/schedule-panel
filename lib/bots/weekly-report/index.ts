import { loadBotConfigById } from "../../core/config-loader";
import { BotDefinition } from "../types";
import { executeWeeklyReportTask } from "./executor";

const loadedConfig = loadBotConfigById("weekly-report");

export const weeklyReportBot: BotDefinition = {
  id: loadedConfig?.bot.id || "weekly-report",
  name: loadedConfig?.bot.name || "周报机器人",
  description: loadedConfig?.bot.description || "前端周报模板自动归档与通知机器人",
  defaultSchedule: loadedConfig?.schedule
    ? {
        name: loadedConfig.schedule.name,
        type: "weekly_report",
        dayOfWeek: loadedConfig.schedule.dayOfWeek,
        time: loadedConfig.schedule.time,
        sourceDocumentId: (loadedConfig.schedule as any).sourceDocumentId || "",
        targetFolderId: (loadedConfig.schedule as any).targetFolderId || "",
        initialMembers: [{ name: "系统自动" }],
      }
    : {
        name: "前端周报更新提醒",
        type: "weekly_report",
        dayOfWeek: 5,
        time: "17:00",
        sourceDocumentId: "",
        targetFolderId: "",
        initialMembers: [{ name: "系统自动" }],
      },
  executeTask: executeWeeklyReportTask,
};

export * from "./period";
export * from "./executor";
export * from "./template";
