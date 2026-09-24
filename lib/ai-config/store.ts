import "server-only";

import fs from "fs";
import path from "path";

export interface AIModelConfig {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  updatedAt?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "ai-settings.json");
const LEGACY_STORE_FILE = path.join(DATA_DIR, "knowledge-migrations.json");

declare global {
  // eslint-disable-next-line no-var
  var __aiModelConfig__: AIModelConfig | undefined;
  // eslint-disable-next-line no-var
  var __aiModelConfigMtime__: number | undefined;
}

function loadLegacyConfig(): AIModelConfig {
  try {
    if (!fs.existsSync(LEGACY_STORE_FILE)) return {};
    const legacy = JSON.parse(fs.readFileSync(LEGACY_STORE_FILE, "utf-8")) as {
      llmConfig?: AIModelConfig;
      config?: AIModelConfig;
    };
    return legacy.llmConfig || legacy.config || {};
  } catch {
    return {};
  }
}

function persist(config: AIModelConfig) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2), "utf-8");
  fs.renameSync(temporary, STORE_FILE);
  global.__aiModelConfig__ = config;
  global.__aiModelConfigMtime__ = fs.statSync(STORE_FILE).mtimeMs;
}

export function getAIModelConfig(): AIModelConfig {
  if (fs.existsSync(STORE_FILE)) {
    const mtime = fs.statSync(STORE_FILE).mtimeMs;
    if (global.__aiModelConfig__ && global.__aiModelConfigMtime__ === mtime) return global.__aiModelConfig__;
    try {
      const config = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as AIModelConfig;
      global.__aiModelConfig__ = config;
      global.__aiModelConfigMtime__ = mtime;
      return config;
    } catch {
      return {};
    }
  }

  const migrated = loadLegacyConfig();
  persist(migrated);
  return migrated;
}

export function saveAIModelConfig(input: Partial<AIModelConfig>): AIModelConfig {
  const previous = getAIModelConfig();
  const next: AIModelConfig = {
    ...previous,
    ...input,
    llmApiKey: input.llmApiKey?.trim() ? input.llmApiKey.trim() : previous.llmApiKey,
    updatedAt: new Date().toISOString(),
  };
  persist(next);
  return next;
}

export function getPublicAIModelConfig() {
  const { llmApiKey, ...config } = getAIModelConfig();
  return { ...config, llmApiKeyConfigured: Boolean(llmApiKey?.trim()) };
}
