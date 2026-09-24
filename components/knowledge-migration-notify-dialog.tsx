"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HelpCircle,
  Loader2,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TaskNotifyConfig } from "@/lib/knowledge-migration/types";

interface BotOption {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  webhookMasked?: string;
}

interface KnowledgeMigrationNotifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskName: string;
  onConfigSaved?: () => Promise<unknown> | void;
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: "每周一" },
  { value: 2, label: "每周二" },
  { value: 3, label: "每周三" },
  { value: 4, label: "每周四" },
  { value: 5, label: "每周五 (推荐)" },
  { value: 6, label: "每周六" },
  { value: 7, label: "每周日" },
];

function formatTime(isoStr?: string) {
  if (!isoStr) return "暂无发送记录";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoStr;
  }
}

export function KnowledgeMigrationNotifyDialog({
  open,
  onOpenChange,
  taskId,
  taskName,
  onConfigSaved,
}: KnowledgeMigrationNotifyDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [availableBots, setAvailableBots] = useState<BotOption[]>([]);
  const [showAdvancedWebhook, setShowAdvancedWebhook] = useState(false);

  const [config, setConfig] = useState<TaskNotifyConfig>({
    enabled: false,
    botId: "",
    webhookUrl: "",
    dayOfWeek: 5,
    time: "18:00",
  });

  // 打开弹窗时拉取最新配置及系统可用机器人
  useEffect(() => {
    if (!open || !taskId) return;
    setMessage(null);
    setLoading(true);

    fetch(`/api/knowledge-migrations/tasks/${taskId}/notify`)
      .then((res) => res.json())
      .then((data) => {
        const bots = Array.isArray(data?.availableBots) ? data.availableBots : [];
        setAvailableBots(bots);

        if (data?.notifyConfig) {
          const loadedConfig = data.notifyConfig as TaskNotifyConfig;
          // 如果当前未设置 botId，但存在可用机器人，默认选中第一个
          if (!loadedConfig.botId && bots.length > 0) {
            loadedConfig.botId = bots[0].id;
          }
          setConfig(loadedConfig);
          // 若原本配了自定义 webhookUrl 但没有对应 botId，自动展开高级设置
          if (loadedConfig.webhookUrl && !loadedConfig.botId) {
            setShowAdvancedWebhook(true);
          }
        }
      })
      .catch((err) => {
        console.error("加载通知配置失败:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, taskId]);

  const selectedBot = availableBots.find((b) => b.id === config.botId);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/notify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "保存失败");
      }
      setConfig(data.notifyConfig);
      setMessage({ type: "success", text: "通知配置已保存！" });
      await onConfigSaved?.();
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "保存配置时出错" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!config.botId && !config.webhookUrl?.trim()) {
      setMessage({ type: "error", text: "请先选择用于发送的飞书机器人" });
      return;
    }

    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/knowledge-migrations/tasks/${taskId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: config.botId || undefined,
          webhookUrl: config.webhookUrl?.trim() || undefined,
          sendMode: config.sendMode || "both",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "发送失败");
      }
      setConfig((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
      }));
      setMessage({ type: "success", text: data?.message || "✅ 测试卡片已成功发送到飞书群，请前往群聊查收！" });
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "发送测试消息失败" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[110] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-2xl focus:outline-none max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                <Bell className="size-4" />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold leading-none">
                  定时发送统计结果到飞书群
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  任务：<span className="font-medium text-foreground">{taskName}</span>
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto size-6 animate-spin text-indigo-600 mb-2" />
              加载配置与可用机器人中…
            </div>
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              {/* 启用开关 */}
              <div className="flex items-center justify-between rounded-xl border border-border/80 bg-muted/30 p-3.5">
                <div className="space-y-0.5">
                  <div className="font-medium text-foreground flex items-center gap-1.5">
                    <span>启用定时自动推送</span>
                    {config.enabled && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                        已启用
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    系统将在设定的时间自动分析文档并推送周报卡片到飞书群
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="size-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </div>

              {/* 飞书机器人选择（直接选择系统已有机器人） */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Bot className="size-3.5 text-indigo-500" />
                    选择推送机器人
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    直接选择系统中已配置的飞书机器人
                  </span>
                </label>

                {availableBots.length > 0 ? (
                  <div className="space-y-2">
                    <select
                      value={config.botId || ""}
                      onChange={(e) => setConfig({ ...config, botId: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="" disabled>
                        请选择一个已配置的飞书机器人
                      </option>
                      {availableBots.map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name} ({bot.webhookMasked || "已配置"})
                        </option>
                      ))}
                    </select>

                    {selectedBot && (
                      <div className="rounded-lg bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 px-3 py-2 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-indigo-950 dark:text-indigo-200">
                            {selectedBot.name}
                          </span>
                          <Badge variant="outline" className="text-[10px] bg-background/60">
                            ID: {selectedBot.id}
                          </Badge>
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {selectedBot.webhookMasked}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
                    <p className="font-medium">系统当前暂未录入已配置的飞书机器人</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      请先前往系统首页或机器人管理页面添加机器人，或展开下方高级设置手动填写 Webhook。
                    </p>
                  </div>
                )}
              </div>

              {/* 定时周期与具体时间 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    推送周期（星期）
                  </label>
                  <select
                    value={config.dayOfWeek}
                    onChange={(e) => setConfig({ ...config, dayOfWeek: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {WEEKDAY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    推送时间（北京时间）
                  </label>
                  <input
                    type="time"
                    value={config.time || "18:00"}
                    onChange={(e) => setConfig({ ...config, time: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* 上次发送记录 */}
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs flex items-center justify-between text-muted-foreground">
                <span>上次成功推送时间：</span>
                <span className="font-mono text-foreground">{formatTime(config.lastSentAt)}</span>
              </div>

              {/* 高级选项折叠：自定义独立 Webhook */}
              <div className="border-t border-border/50 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedWebhook(!showAdvancedWebhook)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <SlidersHorizontal className="size-3" />
                  <span>高级设置：指定独立 Webhook 地址（可选）</span>
                  {showAdvancedWebhook ? (
                    <ChevronUp className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                </button>

                {showAdvancedWebhook && (
                  <div className="mt-2 space-y-1 rounded-lg border border-border bg-muted/20 p-2.5">
                    <label className="text-[11px] text-muted-foreground">
                      若填写，将覆盖上述选中的机器人 Webhook：
                    </label>
                    <input
                      type="text"
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                      value={config.webhookUrl || ""}
                      onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* 操作状态提示 */}
              {message && (
                <div
                  className={`rounded-lg p-2.5 text-xs font-medium ${
                    message.type === "success"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                      : "bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
                  }`}
                >
                  {message.text}
                </div>
              )}

              {/* 弹窗底部操作按钮 */}
              <div className="pt-2 flex items-center justify-between gap-3 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestSend}
                  disabled={testing || saving || (!config.botId && !config.webhookUrl?.trim())}
                  className="text-xs"
                >
                  {testing ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 size-3.5 text-indigo-500" />
                  )}
                  {testing ? "正在发送…" : "发送测试卡片"}
                </Button>

                <div className="flex items-center gap-2">
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm" className="text-xs" disabled={saving}>
                      关闭
                    </Button>
                  </Dialog.Close>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || testing}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                  >
                    {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    {saving ? "保存中…" : "保存配置"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
