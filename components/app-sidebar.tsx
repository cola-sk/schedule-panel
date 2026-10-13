"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, CalendarClock, FolderSync, ListTodo, Orbit, Settings2, Lock } from "lucide-react";
import { isLocalhost, isWhitelistedPageRoute, ADMIN_TOKEN_KEY } from "@/lib/auth/permissions";

const links = [
  { href: "/", label: "定时任务", icon: CalendarClock },
  { href: "/knowledge-migration", label: "知识库归档", icon: BookOpen },
  { href: "/drive-migration", label: "网盘迁移", icon: FolderSync },
  { href: "/meeting", label: "会议行动", icon: ListTodo },
  { href: "/settings", label: "设置", icon: Settings2 },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [isReadOnlyMode, setIsReadOnlyMode] = useState(false);

  useEffect(() => {
    const isLocal = isLocalhost(window.location.hostname);
    const hasToken = Boolean(localStorage.getItem(ADMIN_TOKEN_KEY));
    setIsReadOnlyMode(!isLocal && !hasToken);
  }, []);

  return (
    <aside className="fixed inset-y-0 z-40 flex w-60 flex-col border-r border-border bg-card px-3 py-6 select-none">
      <div>
        <Link href="/" className="group mb-8 flex items-center gap-2.5 px-3 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background shadow-xs transition-transform group-hover:scale-105">
            <Orbit className="size-4" />
          </span>
          <span className="font-semibold tracking-tight text-foreground">Orbit</span>
        </Link>
        <nav className="space-y-1 text-sm font-medium">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
            const isWhitelisted = isWhitelistedPageRoute(href);
            const showReadOnly = isReadOnlyMode && !isWhitelisted;

            return (
              <Link
                key={href}
                href={href}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {showReadOnly && (
                  <span className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground/70 bg-secondary/80 font-normal">
                    <Lock className="size-2.5" />
                    <span>只读</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
