import { useLiveNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
  type AppNotification,
} from "@/features/notifications/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell, CheckCheck, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

/** Header bell: unread count, and the newest notifications when opened. */
export function NotificationBell() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const live = useLiveNotifications();
  const unread = useUnreadNotificationCount(live).data ?? 0;
  const list = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  function openNotification(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    // Straight to the answer or reply it is about (the question page lights it up).
    navigate(`/forum/${n.threadId}#${n.commentId ? `answer-${n.commentId}` : "question"}`, { viewTransition: true });
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-tour="notifications"
          aria-label={unread > 0 ? `${t("notifications")} (${unread})` : t("notifications")}
          className="relative rounded-lg p-2 text-primary hover:bg-background-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 ? (
            <span className="absolute right-0.5 top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex max-h-[min(28rem,70dvh)] w-[min(22rem,calc(100vw-1.5rem))] flex-col rounded-2xl border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <p className="text-sm font-bold text-primary">{t("notifications")}</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markAll.mutate(undefined)}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold text-primary-light hover:bg-background-2"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t("notificationsMarkAll")}
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {list.isPending ? (
              <p className="px-3 py-4 text-sm text-label">{t("loading")}</p>
            ) : list.isError ? (
              <p className="px-3 py-4 text-sm text-error">{t("notificationsLoadFailed")}</p>
            ) : list.data.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-label">{t("notificationsEmpty")}</p>
            ) : (
              list.data.map((n) => <NotificationItem key={n.id} n={n} onOpen={() => openNotification(n)} />)
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const NOTIF_TEXT: Record<AppNotification["type"], TranslationKey> = {
  comment_on_thread: "notifCommentOnThread",
  reply_to_comment: "notifReplyToComment",
  mention: "notifMention",
  answer_liked: "notifAnswerLiked",
  answer_accepted: "notifAnswerAccepted",
};

function NotificationItem({ n, onOpen }: { n: AppNotification; onOpen: () => void }) {
  const { t, locale } = useLocale();
  const text = t(NOTIF_TEXT[n.type] ?? "notifCommentOnThread")
    .replace("{name}", n.actorName)
    .replace("{title}", n.threadTitle);
  return (
    <DropdownMenu.Item
      onSelect={onOpen}
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-background-2",
        !n.read && "bg-background-2/60",
      )}
    >
      <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary-light" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm text-primary", !n.read && "font-semibold")}>{text}</p>
        <p className="mt-0.5 text-xs text-label">{formatRelativeTime(n.createdAt, locale)}</p>
      </div>
      {!n.read ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600" aria-hidden /> : null}
    </DropdownMenu.Item>
  );
}
