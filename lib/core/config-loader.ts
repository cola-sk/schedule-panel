import fs from "fs";
import path from "path";
import { BotConfig, ReminderSchedule, RotationMember } from "./types";

export interface BotJsonConfigFile {
  bot: {
    id: string;
    name: string;
    description?: string;
    webhookUrl?: string;
    enabled?: boolean;
  };
  schedule?: {
    id?: string;
    name: string;
    documentId?: string;
    dayOfWeek: number;
    time: string;
    timezone?: string;
    rotationStartAt?: string;
    currentIndex?: number;
    initialMembers?: RotationMember[];
  };
}

const CONFIG_DIR = path.join(process.cwd(), "config");

export function loadAllBotConfigs(): BotJsonConfigFile[] {
  const configs: BotJsonConfigFile[] = [];
  try {
    if (fs.existsSync(CONFIG_DIR)) {
      const files = fs.readdirSync(CONFIG_DIR);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(CONFIG_DIR, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(raw) as BotJsonConfigFile;
          if (parsed?.bot?.id && parsed?.bot?.name) {
            configs.push(parsed);
          }
        }
      }
    }
  } catch (error) {
    console.error("加载 config/ 目录配置文件失败:", error);
  }
  return configs;
}

export function loadBotConfigById(id: string): BotJsonConfigFile | undefined {
  const all = loadAllBotConfigs();
  return all.find((item) => item.bot.id === id);
}
