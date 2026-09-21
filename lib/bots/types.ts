import { BotConfig, FeishuMessagePayload, ReminderSchedule, ReminderTask, RotationMember } from "../core/types";

export interface MessageContext {
  host: RotationMember;
  schedule: ReminderSchedule;
  bot: BotConfig;
  scheduledAt?: string;
}

export interface TaskExecutionContext {
  schedule: ReminderSchedule;
  task: ReminderTask;
  bot?: BotConfig;
  scheduledAt: string;
}

export interface TaskExecutionResult {
  mocked: boolean;
  message?: string;
  botId?: string;
  botName?: string;
  content: string;
  documentUrl?: string;
  createdNodeToken?: string;
}

export interface BotDefinition {
  /** 唯一标识，如 "febot" 或 "weekly-report" */
  id: string;
  /** 显示名称 */
  name: string;
  /** 功能描述 */
  description?: string;
  /** 默认绑定的飞书文档/表格/知识库 URL */
  defaultDocumentId?: string;
  /** 默认定时配置 */
  defaultSchedule?: {
    name: string;
    type?: string;
    dayOfWeek: number;
    time: string;
    rotationStartAt?: string;
    currentIndex?: number;
    initialMembers?: RotationMember[];
    sourceDocumentId?: string;
    targetFolderId?: string;
  };
  /** 构建个性化飞书消息/卡片 */
  buildMessage?: (context: MessageContext) => FeishuMessagePayload;
  /** 专用任务执行器（如自动拉取并创建周报文档） */
  executeTask?: (context: TaskExecutionContext) => Promise<TaskExecutionResult>;
  /** 可选：针对该 Bot 的专用名单解析钩子（未提供则使用通用解析器） */
  customFetchRotation?: (source: string) => Promise<RotationMember[]>;
}
