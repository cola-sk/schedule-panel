"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarClock, ListTodo, Settings2 } from "lucide-react";

const links = [
  { href: "/", label: "定时任务", icon: CalendarClock },
  { href: "/knowledge-migration", label: "知识库归档", icon: BookOpen },
  { href: "/meeting", label: "会议行动", icon: ListTodo },
  { href: "/settings", label: "设置", icon: Settings2 },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 z-40 flex w-60 flex-col border-r border-border bg-card px-3 py-6 select-none">
      <div>
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-3 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-mono font-medium text-background">
            F
          </span>
          <span>前端机器人</span>
        </Link>
        <nav className="space-y-1 text-sm font-medium">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
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
                <Icon className="size-4" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
