"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Cpu, Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Config = { llmBaseUrl?: string; llmModel?: string; llmApiKeyConfigured?: boolean };

const inputControlClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function AISettingsPanel() {
  const [config, setConfig] = useState<Config>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string }>();

  useEffect(() => {
    void fetch("/api/settings/ai", { cache: "no-store" })
      .then(async (response) => ({
        response,
        body: (await response.json()) as { config?: Config; error?: string },
      }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || "加载 AI 配置失败");
        setConfig(body.config || {});
      })
      .catch((error: unknown) =>
        setNotice({
          type: "error",
          text: error instanceof Error ? error.message : "加载 AI 配置失败",
        })
      )
      .finally(() => setLoading(false));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(undefined);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/settings/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = (await response.json()) as { config?: Config; error?: string };
      if (!response.ok) throw new Error(body.error || "保存 AI 配置失败");
      setConfig(body.config || {});
      setNotice({
        type: "success",
        text: "通用 AI 配置已保存，会议行动提取与知识库归档将共享此模型服务。",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "保存 AI 配置失败",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">AI 大语言模型配置</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          设置兼容 OpenAI 规范的模型服务端点与密钥，供「会议行动助手」与「知识库归档」等智能化能力共用。
        </p>
      </div>

      <Card className="max-w-3xl">
        <CardContent className="p-6">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>正在读取 AI 配置…</span>
            </div>
          ) : (
            <form onSubmit={save} className="space-y-5">
              <div className="rounded-lg border border-border/80 bg-secondary/30 p-4 text-sm leading-6 text-foreground/80">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Sparkles className="size-4 text-amber-500" />
                  <span>多模块共享能力说明</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  系统采用统一的 LLM 抽象层：会议行动助手使用该模型进行结构化要点与 5W1H
                  行动项提取；知识库归档使用该模型进行目录分类与摘要归纳。API Key
                  全程仅存储于服务端受控环境。
                </p>
              </div>

              <div className="space-y-4">
                <label className="grid gap-1.5 text-sm font-medium">
                  <span>API Base URL</span>
                  <input
                    name="llmBaseUrl"
                    defaultValue={config?.llmBaseUrl || ""}
                    placeholder="https://api.openai.com/v1"
                    className={inputControlClass}
                  />
                  <span className="text-xs font-normal text-muted-foreground">
                    OpenAI 兼容接口基地址，支持 DeepSeek、Moonshot、OneAPI、自建转发服务等。
                  </span>
                </label>

                <label className="grid gap-1.5 text-sm font-medium">
                  <span>模型名称</span>
                  <input
                    name="llmModel"
                    defaultValue={config?.llmModel || ""}
                    placeholder="例如：gpt-4o、claude-3-5-sonnet、deepseek-chat"
                    className={inputControlClass}
                  />
                  <span className="text-xs font-normal text-muted-foreground">
                    调用的模型标识，请确认该模型在上述 Base URL 服务商处可用。
                  </span>
                </label>

                <label className="grid gap-1.5 text-sm font-medium">
                  <span>API Key</span>
                  <div className="relative">
                    <input
                      name="llmApiKey"
                      type={showKey ? "text" : "password"}
                      placeholder={config?.llmApiKeyConfigured ? "已配置（留空保持不变）" : "sk-..."}
                      className={`${inputControlClass} pr-10 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <span className="text-xs font-normal text-muted-foreground">
                    {config?.llmApiKeyConfigured
                      ? "状态：已配置安全 Key。若无需修改请留空。"
                      : "尚未配置 API Key，请填入有效的密钥凭证。"}
                  </span>
                </label>
              </div>

              {notice && (
                <div
                  className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
                    notice.type === "success"
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {notice.type === "success" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleAlert className="size-4 shrink-0 text-red-600" />
                  )}
                  <span>{notice.text}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">
                  {config?.llmApiKeyConfigured ? "已妥善配置服务端 Key" : "未检测到 API Key"}
                </span>
                <Button size="sm" type="submit" disabled={saving}>
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  {saving ? "保存中…" : "保存配置"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
