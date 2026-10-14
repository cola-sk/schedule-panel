"use client";

import { useEffect, useState, useRef } from "react";
import { AtSign, Check, Copy, Mail, Search, User } from "lucide-react";
import { RosterMember } from "@/lib/roster/types";

interface RosterMentionPickerProps {
  onSelect?: (member: RosterMember) => void;
  className?: string;
  placeholder?: string;
}

export function RosterMentionPicker({
  onSelect,
  className = "",
  placeholder = "输入姓名或邮箱检索成员...",
}: RosterMentionPickerProps) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fetchMembers(query);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, isOpen]);

  async function fetchMembers(q: string) {
    setLoading(true);
    try {
      const url = q.trim() ? `/api/roster/query?q=${encodeURIComponent(q.trim())}` : `/api/roster/query`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && Array.isArray(data.members)) {
        setMembers(data.members);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onFocus={() => {
            setIsOpen(true);
            if (members.length === 0) fetchMembers("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder={placeholder}
          className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-7 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <AtSign className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground opacity-60" />
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
          {loading ? (
            <div className="py-4 text-center text-xs text-muted-foreground">检索成员中...</div>
          ) : members.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">未找到匹配的成员</div>
          ) : (
            <div className="space-y-0.5">
              {members.map((member) => (
                <div
                  key={member.id}
                  onClick={() => {
                    onSelect?.(member);
                    setIsOpen(false);
                  }}
                  className="flex items-center justify-between rounded px-2.5 py-1.5 text-xs transition-colors hover:bg-secondary cursor-pointer"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
                      {member.name.slice(0, 1)}
                    </span>
                    <div className="overflow-hidden">
                      <div className="font-medium text-foreground truncate">{member.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{member.email || "无邮箱"}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {member.email && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(member.email, `mail-${member.id}`);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-secondary-foreground/10 hover:text-foreground"
                        title="复制邮箱"
                      >
                        {copiedId === `mail-${member.id}` ? (
                          <Check className="size-3 text-emerald-600" />
                        ) : (
                          <Mail className="size-3" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(member.atTag, `tag-${member.id}`);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary-foreground/10 hover:text-emerald-600"
                      title="复制 @ 语法"
                    >
                      {copiedId === `tag-${member.id}` ? (
                        <Check className="size-3 text-emerald-600" />
                      ) : (
                        <AtSign className="size-3" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
