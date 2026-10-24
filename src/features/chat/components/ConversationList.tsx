import {
  useChatConversations,
  useDeleteConversation,
  useUpdateConversation,
  type ChatConversation,
} from "@/features/chat/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { Check, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type GroupKey = Extract<TranslationKey, "chatPinned" | "chatToday" | "chatPrevious7" | "chatOlder">;

function groupOf(c: ChatConversation, now: Date): GroupKey {
  if (c.pinned) return "chatPinned";
  const updated = new Date(c.updatedAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (updated >= startOfToday) return "chatToday";
  if (now.getTime() - updated.getTime() < 7 * 24 * 3600_000) return "chatPrevious7";
  return "chatOlder";
}

/**
 * The student's chats, pinned first, then by last activity, in date groups.
 * Each row can be renamed, pinned or deleted. onNavigate runs when a chat is
 * opened (the phone sheet closes itself with it).
 */
export function ConversationList({ activeId, onNavigate }: { activeId?: string; onNavigate?: () => void }) {
  const { t, plural } = useLocale();
  const { data, isPending, isError } = useChatConversations();

  if (isPending) return <p className="px-2 py-1 text-sm text-label">{t("loading")}</p>;
  if (isError) return <p className="px-2 py-1 text-sm text-error">{t("serverUnavailable")}</p>;

  const now = new Date();
  const groups = new Map<GroupKey, ChatConversation[]>();
  for (const c of data.conversations) {
    const key = groupOf(c, now);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {data.conversations.length === 0 ? (
          <p className="px-2 py-1 text-sm text-label">{t("chatListEmpty")}</p>
        ) : (
          (["chatPinned", "chatToday", "chatPrevious7", "chatOlder"] as const)
            .filter((key) => groups.has(key))
            .map((key) => (
              <section key={key} aria-label={t(key)}>
                <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-label">{t(key)}</h3>
                <ul className="space-y-0.5">
                  {groups.get(key)!.map((c) => (
                    <ConversationRow key={c.id} conv={c} active={c.id === activeId} onNavigate={onNavigate} />
                  ))}
                </ul>
              </section>
            ))
        )}
      </div>
      {data.retentionDays > 0 ? (
        <p className="mt-3 border-t border-border/50 px-2 pt-3 text-[11px] leading-snug text-label">
          {t("chatRetentionNote").replace("{days}", plural(data.retentionDays, "chatRetentionDays"))}
        </p>
      ) : null}
    </div>
  );
}

type RowMode = "idle" | "menu" | "rename" | "confirmDelete";

function ConversationRow({
  conv,
  active,
  onNavigate,
}: {
  conv: ChatConversation;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const update = useUpdateConversation();
  const remove = useDeleteConversation();
  const [mode, setMode] = useState<RowMode>("idle");
  const [title, setTitle] = useState(conv.title);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = conv.title || t("chatUntitled");

  useEffect(() => {
    if (mode === "rename") inputRef.current?.select();
  }, [mode]);

  function act(run: () => Promise<unknown>) {
    setFailed(false);
    run().then(
      () => setMode("idle"),
      () => setFailed(true),
    );
  }

  function saveTitle() {
    const next = title.trim();
    if (!next || next === conv.title) {
      setMode("idle");
      return;
    }
    act(() => update.mutateAsync({ id: conv.id, title: next }));
  }

  function deleteChat() {
    act(async () => {
      await remove.mutateAsync(conv.id);
      if (active) navigate("/chat", { replace: true });
    });
  }

  if (mode === "rename") {
    return (
      <li className="px-1 py-0.5">
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            saveTitle();
          }}
        >
          <input
            ref={inputRef}
            value={title}
            maxLength={100}
            aria-label={t("chatRename")}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMode("idle");
            }}
            className="min-w-0 flex-1 rounded-lg border border-primary px-2 py-1.5 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <IconButton label={t("save")} type="submit" disabled={update.isPending}>
            <Check className="h-4 w-4" />
          </IconButton>
          <IconButton label={t("cancel")} onClick={() => setMode("idle")}>
            <X className="h-4 w-4" />
          </IconButton>
        </form>
        {failed ? <p className="px-1 pt-1 text-xs text-error">{t("chatActionFailed")}</p> : null}
      </li>
    );
  }

  return (
    <li>
      <div
        className={cn(
          "group flex items-center rounded-xl transition-colors hover:bg-background-2",
          (active || mode !== "idle") && "bg-background-2",
        )}
      >
        <Link
          to={`/chat/${conv.id}`}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          title={label}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-sm text-primary/80",
            active && "font-semibold text-primary",
          )}
        >
          {conv.pinned ? <Pin className="h-3 w-3 shrink-0 text-label" aria-hidden /> : null}
          <span className="truncate">{label}</span>
        </Link>
        <button
          type="button"
          aria-label={t("chatActions")}
          aria-expanded={mode !== "idle"}
          onClick={() => {
            setFailed(false);
            setMode(mode === "idle" ? "menu" : "idle");
          }}
          className={cn(
            "mr-1 shrink-0 rounded-lg p-1.5 text-label hover:bg-surface hover:text-primary focus-visible:opacity-100",
            // Shown on hover on a computer; always on touch screens.
            mode === "idle" && !active && "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {mode === "menu" ? (
        <div className="flex flex-wrap gap-1 px-2 pb-1 pt-1">
          <MenuButton
            onClick={() => {
              setTitle(conv.title);
              setMode("rename");
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("chatRename")}
          </MenuButton>
          <MenuButton
            disabled={update.isPending}
            onClick={() => act(() => update.mutateAsync({ id: conv.id, pinned: !conv.pinned }))}
          >
            {conv.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {conv.pinned ? t("chatUnpin") : t("chatPin")}
          </MenuButton>
          <MenuButton danger onClick={() => setMode("confirmDelete")}>
            <Trash2 className="h-3.5 w-3.5" />
            {t("chatDelete")}
          </MenuButton>
        </div>
      ) : null}

      {mode === "confirmDelete" ? (
        <div className="space-y-2 px-2 pb-2 pt-1" role="alertdialog" aria-label={t("chatDeleteConfirm")}>
          <p className="text-xs text-primary">{t("chatDeleteConfirm")}</p>
          <div className="flex gap-1">
            <MenuButton danger disabled={remove.isPending} onClick={deleteChat}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("chatDelete")}
            </MenuButton>
            <MenuButton onClick={() => setMode("idle")}>{t("cancel")}</MenuButton>
          </div>
        </div>
      ) : null}

      {failed ? <p className="px-3 pb-1 text-xs text-error">{t("chatActionFailed")}</p> : null}
    </li>
  );
}

function MenuButton({
  danger,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border/60 bg-surface px-2 py-1 text-xs font-medium text-primary hover:bg-background-2 disabled:opacity-60",
        danger && "border-error/30 text-error hover:bg-error/5",
        className,
      )}
    />
  );
}

function IconButton({ label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      {...props}
      className="shrink-0 rounded-lg p-1.5 text-label hover:bg-background-2 hover:text-primary disabled:opacity-60"
    />
  );
}
