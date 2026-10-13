"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Lock, Unlock, ShieldAlert, KeyRound, X } from "lucide-react";
import { isLocalhost, isWhitelistedPageRoute, isWhitelistedApiRoute, ADMIN_TOKEN_KEY } from "@/lib/auth/permissions";

export function AccessGuard() {
  const pathname = usePathname();
  const [isClient, setIsClient] = useState(false);
  const [isLocal, setIsLocal] = useState(false);
  const [hasAdminToken, setHasAdminToken] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 初始化客户端状态
  useEffect(() => {
    setIsClient(true);
    const local = isLocalhost(window.location.hostname);
    setIsLocal(local);
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    setHasAdminToken(Boolean(token));
  }, []);

  const isWhitelisted = isWhitelistedPageRoute(pathname);
  const isReadOnly = isClient && !isLocal && !hasAdminToken && !isWhitelisted;

  // 显示临时警告 Toast
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4000);
  }, []);

  // 全局拦截非白名单路由下的写请求（POST / PUT / DELETE / PATCH）
  useEffect(() => {
    if (!isClient) return;

    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      const [resource, config] = args;
      const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
      const method = (config?.method || "GET").toUpperCase();

      // 仅拦截写请求
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const local = isLocalhost(window.location.hostname);
        const token = localStorage.getItem(ADMIN_TOKEN_KEY);
        const currentPath = window.location.pathname;

        // 如果在外部域名、无管理员密钥、且不在白名单路由或白名单 API
        const isPageAllowed = isWhitelistedPageRoute(currentPath);
        const isApiAllowed = isWhitelistedApiRoute(url);

        if (!local && !token && !isPageAllowed && !isApiAllowed) {
          showToast("当前功能处于访客只读模式，仅支持查阅数据，禁止修改或执行操作。");

          // 返回模拟的 403 响应，阻止向服务器发送写请求并防止页面崩溃
          return new Response(
            JSON.stringify({
              error: "只读模式：当前外部域名仅开放只读访问，该操作被禁止。",
              code: "READ_ONLY_MODE",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // 如果配置了 admin token，注入请求头
        if (token && config) {
          config.headers = {
            ...config.headers,
            "x-admin-token": token,
          };
        }
      }

      return originalFetch.apply(window, args);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [isClient, showToast]);

  function handleUnlock() {
    setUnlockError("");
    if (!tokenInput.trim()) {
      setUnlockError("请输入管理员口令");
      return;
    }

    // 默认管理员口令：orbit-admin（或环境变量指定）
    const validKey = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "orbit-admin";
    if (tokenInput.trim() === validKey) {
      localStorage.setItem(ADMIN_TOKEN_KEY, tokenInput.trim());
      // 设置 Cookie 便于服务端 middleware 识别
      document.cookie = `${ADMIN_TOKEN_KEY}=${encodeURIComponent(tokenInput.trim())}; path=/; max-age=2592000`;
      setHasAdminToken(true);
      setShowUnlockModal(false);
      showToast("已成功解锁管理员权限，所有功能已开放！");
      setTimeout(() => window.location.reload(), 600);
    } else {
      setUnlockError("口令错误，请重试");
    }
  }

  function handleRelock() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    document.cookie = `${ADMIN_TOKEN_KEY}=; path=/; max-age=0`;
    setHasAdminToken(false);
    showToast("已切换回访客只读模式");
    setTimeout(() => window.location.reload(), 600);
  }

  if (!isClient) return null;

  return (
    <>
      {/* 拦截 Toast 提醒 */}
      {toastMessage && (
        <div
          role="alert"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] flex max-w-md items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900 shadow-xl dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 animate-in fade-in slide-in-from-top-4"
        >
          <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="flex-1">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-amber-700/60 hover:text-amber-900 dark:text-amber-300/60 dark:hover:text-amber-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* 只读模式顶部提示条（仅在只读页面且非管理员时渲染） */}
      {isReadOnly && (
        <div className="fixed top-0 right-0 left-60 z-30 flex items-center justify-between border-b border-amber-200/80 bg-amber-50/90 px-6 py-1.5 text-xs text-amber-800 backdrop-blur-sm dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <Lock className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>访客只读模式：</strong>当前功能仅开放数据查阅；若需完整操作权限，请解锁管理权限。
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowUnlockModal(true)}
            className="inline-flex items-center gap-1 font-medium text-amber-900 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-100 underline underline-offset-2 ml-4 shrink-0"
          >
            <KeyRound className="size-3" />
            <span>管理解锁</span>
          </button>
        </div>
      )}

      {/* 管理员已在外部域名解锁的状态标志 */}
      {!isLocal && hasAdminToken && (
        <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11px] text-emerald-800 shadow-sm backdrop-blur-sm dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-300">
          <Unlock className="size-3 text-emerald-600 dark:text-emerald-400" />
          <span>管理员模式</span>
          <button
            type="button"
            onClick={handleRelock}
            className="ml-1 text-muted-foreground hover:text-destructive underline"
            title="退出管理员模式并切回只读"
          >
            退出
          </button>
        </div>
      )}

      {/* 解锁弹窗 */}
      {showUnlockModal && (
        <div className="fixed inset-0 z-[250] grid place-items-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <span>输入管理员口令</span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowUnlockModal(false);
                  setUnlockError("");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              外部域名默认仅放行「网盘迁移」操作权限。输入管理口令后，可临时解锁本机的完全修改权限。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleUnlock();
              }}
              className="space-y-4"
            >
              <div>
                <input
                  type="password"
                  placeholder="请输入管理口令（默认 orbit-admin）"
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    setUnlockError("");
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />
                {unlockError && <p className="mt-1 text-xs text-destructive">{unlockError}</p>}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowUnlockModal(false);
                    setUnlockError("");
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  验证解锁
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
