import { BotDefinition } from "./types";
import { febot } from "./febot";
import { weeklyReportBot } from "./weekly-report";

/**
 * 所有注册的机器人业务插件
 */
const botRegistry = new Map<string, BotDefinition>([
  [febot.id, febot],
  [weeklyReportBot.id, weeklyReportBot],
]);

/**
 * 注册一个新的 Bot 业务定制插件
 */
export function registerBot(bot: BotDefinition) {
  botRegistry.set(bot.id, bot);
}

/**
 * 根据 Bot ID 获取对应的业务定制定义
 */
export function getBotDefinition(id: string): BotDefinition | undefined {
  return botRegistry.get(id);
}

/**
 * 列出所有已注册的 Bot 业务定义
 */
export function listBotDefinitions(): BotDefinition[] {
  return Array.from(botRegistry.values());
}

export * from "./types";
