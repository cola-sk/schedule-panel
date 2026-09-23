import { loadBotConfigById } from "../../core/config-loader";
import { BotDefinition } from "../types";
import { buildWeeklyMeetingReminder } from "./template";

const loadedConfig = loadBotConfigById("febot");

export const febot: BotDefinition = {
  id: loadedConfig?.bot.id || "febot",
  name: loadedConfig?.bot.name || "FEBot",
  description: loadedConfig?.bot.description || "前端团队周会主持轮值提醒机器人",
  defaultDocumentId: loadedConfig?.schedule?.documentId,
  defaultSchedule: loadedConfig?.schedule
    ? {
        name: loadedConfig.schedule.name,
        dayOfWeek: loadedConfig.schedule.dayOfWeek,
        time: loadedConfig.schedule.time,
        rotationStartAt: loadedConfig.schedule.rotationStartAt || "2026-09-07T10:00:00+08:00",
        initialMembers: loadedConfig.schedule.initialMembers || [],
      }
    : {
        name: "前端技术周会主持提醒",
        dayOfWeek: 1,
        time: "10:00",
        rotationStartAt: "2026-09-07T10:00:00+08:00",
        initialMembers: [],
      },
  buildMessage: buildWeeklyMeetingReminder,
};
