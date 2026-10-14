"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Bot, Cpu, Settings2, Users } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { BotManagementPanel } from "@/components/bot-management-panel";
import { AISettingsPanel } from "@/components/ai-settings-panel";
import { RosterManagementPanel } from "@/components/roster-management-panel";

type SettingsTab = "bots" | "ai" | "roster";

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabQuery = searchParams.get("tab");
  const initialTab: SettingsTab =
    tabQuery === "ai" || tabQuery === "roster" ? tabQuery : "bots";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "ai" || tabParam === "bots" || tabParam === "roster") {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  function switchTab(tab: SettingsTab) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`);
  }

  return (
    <div className="space-y-8">
      {/* 页面标题 */}
      <div>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-foreground text-background">
            <Settings2 className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">系统设置</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管理全局飞书机器人 Webhook、AI 大模型配置与通用飞书成员名单，供各业务模块统一调用。
            </p>
          </div>
        </div>

        {/* 顶部标签页切换 */}
        <div className="mt-7 flex items-center border-b border-border">
          <button
            type="button"
            onClick={() => switchTab("bots")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "bots"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bot className="size-4" />
            <span>飞书机器人配置</span>
          </button>
          <button
            type="button"
            onClick={() => switchTab("ai")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "ai"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Cpu className="size-4" />
            <span>AI 大模型配置</span>
          </button>
          <button
            type="button"
            onClick={() => switchTab("roster")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "roster"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="size-4" />
            <span>飞书成员名单 & @</span>
          </button>
        </div>
      </div>

      {/* 标签页主体内容 */}
      <div>
        {activeTab === "bots" && <BotManagementPanel />}
        {activeTab === "ai" && <AISettingsPanel />}
        {activeTab === "roster" && <RosterManagementPanel />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppSidebar />
      <main className="ml-60 min-h-screen max-w-[1400px] p-8 lg:p-10">
        <Suspense fallback={<div className="py-8 text-sm text-muted-foreground">加载设置中…</div>}>
          <SettingsContent />
        </Suspense>
      </main>
    </div>
  );
}
