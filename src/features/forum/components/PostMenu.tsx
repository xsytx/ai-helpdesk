import { useAuth } from "@/app/AuthContext";
import { isStaffRole } from "@/features/moderation/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Flag, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { PostActionError } from "../postActions";

/**
 * Who may do what with a post: the author edits and deletes, admins delete
 * anything, any other signed-in student may report it.
 */
export function usePostPermissions(authorId: string) {
  const { user } = useAuth();
  const own = Boolean(user) && user!.id === authorId;
  return { canEdit: own, canDelete: own || isStaffRole(user?.role), canReport: Boolean(user) && !own };
}

/** "⋯" menu on a question or answer. Renders nothing if the user may do neither. */
export function PostMenu({
  canEdit,
  canDelete,
  canReport = false,
  onEdit,
  onDelete,
  onReport,
}: {
  canEdit: boolean;
  canDelete: boolean;
  canReport?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReport?: () => void;
}) {
  const { t } = useLocale();
  if (!canEdit && !canDelete && !canReport) return null;
  const item =
    "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none data-[highlighted]:bg-background-2";

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("postActions")}
          className="shrink-0 rounded-lg p-1.5 text-label hover:bg-background-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="z-50 min-w-[9rem] rounded-xl border border-border bg-surface p-1 shadow-lg" sideOffset={4} align="end">
          {canEdit ? (
            <DropdownMenu.Item className={cn(item, "text-primary")} onSelect={onEdit}>
              <Pencil className="h-4 w-4" />
              {t("postEdit")}
            </DropdownMenu.Item>
          ) : null}
          {canReport && onReport ? (
            <DropdownMenu.Item className={cn(item, "text-primary")} onSelect={onReport}>
              <Flag className="h-4 w-4" />
              {t("reportPost")}
            </DropdownMenu.Item>
          ) : null}
          {canDelete ? (
            <DropdownMenu.Item className={cn(item, "text-error")} onSelect={onDelete}>
              <Trash2 className="h-4 w-4" />
              {t("postDelete")}
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The "really delete?" bar shown inside the post. */
export function DeleteConfirm({
  messageKey,
  busy,
  onConfirm,
  onCancel,
}: {
  messageKey: TranslationKey;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-error/30 bg-error/5 p-3"
      role="alertdialog"
      aria-label={t(messageKey)}
    >
      <p className="mr-auto text-sm text-primary">{t(messageKey)}</p>
      <Button size="sm" className="bg-error hover:bg-error/90" disabled={busy} onClick={onConfirm}>
        {t("postDelete")}
      </Button>
      <Button size="sm" variant="secondary" onClick={onCancel}>
        {t("cancel")}
      </Button>
    </div>
  );
}

const ERROR_KEY: Record<PostActionError, TranslationKey> = {
  underReview: "postUnderReviewNoEdit",
  blocked: "postEditBlocked",
  forbidden: "postActionFailed",
  restricted: "postActionRestricted",
  failed: "postActionFailed",
};

export function PostActionErrorText({ error }: { error?: PostActionError }) {
  const { t } = useLocale();
  if (!error) return null;
  return (
    <p className="mt-2 text-sm text-error" role="alert">
      {t(ERROR_KEY[error])}
    </p>
  );
}
