import { FAQ_CATEGORIES, faqText, type FaqEntry } from "@/entities/faq";
import { useDeleteFaq, useFaqs, useReorderFaqs, useSaveFaq, type FaqDraft } from "@/features/faq/api";
import { FAQ_CATEGORY_KEY } from "@/features/faq/categories";
import { useLocale } from "@/i18n/LocaleContext";
import type { Locale } from "@/i18n/translations";
import { getErrorStatus } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";

// Language names are written in their own language, like in the switcher.
const LANGUAGES: { locale: Locale; name: string }[] = [
  { locale: "en", name: "English" },
  { locale: "kz", name: "Қазақша" },
  { locale: "ru", name: "Русский" },
];

const emptyDraft = (): FaqDraft => ({
  question: { en: "", kz: "", ru: "" },
  answer: { en: "", kz: "", ru: "" },
  category: "general",
  pinned: true,
});

const toDraft = (e: FaqEntry): FaqDraft => ({
  question: { ...e.question },
  answer: { ...e.answer },
  category: e.category,
  pinned: e.pinned,
});

/** Languages where the question or the answer is still empty. */
function missingLanguages(d: FaqDraft): Locale[] {
  return LANGUAGES.map((l) => l.locale).filter((l) => !d.question[l].trim() || !d.answer[l].trim());
}

/**
 * Admin panel section: add, edit, delete and order FAQ entries, and choose
 * which ones are buttons in the AI chat. initialDraft opens the "add" form
 * already filled in (e.g. "Make it an FAQ" from the AI chat section).
 */
export function FaqEditor({ initialDraft, onDraftUsed }: { initialDraft?: FaqDraft; onDraftUsed?: () => void }) {
  const { t } = useLocale();
  const { data: entries = [], isPending, isError } = useFaqs();
  const reorder = useReorderFaqs();
  // "new" = the add form is open; an id = that entry is being edited.
  const [editing, setEditing] = useState<string | null>(initialDraft ? "new" : null);
  const [failed, setFailed] = useState(false);

  function move(index: number, by: -1 | 1) {
    const ids = entries.map((e) => e.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    setFailed(false);
    reorder.mutate(ids, { onError: () => setFailed(true) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-label">{t("faqEditorHint")}</p>
        {editing !== "new" ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            {t("faqAdd")}
          </Button>
        ) : null}
      </div>

      {editing === "new" ? (
        <FaqForm
          initial={initialDraft ?? emptyDraft()}
          onDone={() => {
            setEditing(null);
            onDraftUsed?.();
          }}
        />
      ) : null}
      {isPending ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {isError ? <p className="text-sm text-error">{t("faqLoadFailed")}</p> : null}
      {failed ? <p className="text-sm text-error">{t("faqActionFailed")}</p> : null}
      {!isPending && !isError && entries.length === 0 ? <p className="text-sm text-label">{t("faqEmpty")}</p> : null}

      <ol className="space-y-2">
        {entries.map((entry, index) =>
          editing === entry.id ? (
            <li key={entry.id}>
              <FaqForm id={entry.id} initial={toDraft(entry)} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <FaqRow
              key={entry.id}
              entry={entry}
              index={index}
              last={index === entries.length - 1}
              busy={reorder.isPending}
              onMove={(by) => move(index, by)}
              onEdit={() => setEditing(entry.id)}
            />
          ),
        )}
      </ol>
    </div>
  );
}

function FaqRow({
  entry,
  index,
  last,
  busy,
  onMove,
  onEdit,
}: {
  entry: FaqEntry;
  index: number;
  last: boolean;
  busy: boolean;
  onMove: (by: -1 | 1) => void;
  onEdit: () => void;
}) {
  const { t, locale } = useLocale();
  const remove = useDeleteFaq();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const { question, answer } = faqText(entry, locale);
  const missing = missingLanguages(toDraft(entry));

  return (
    <li className="rounded-2xl border border-white/60 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-semibold text-label">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full bg-background-2 px-2 py-0.5 text-primary">{t(FAQ_CATEGORY_KEY[entry.category])}</span>
            {entry.pinned ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                <Zap className="h-3 w-3" aria-hidden />
                {t("faqPinnedBadge")}
              </span>
            ) : null}
            {missing.length > 0 ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">
                {t("faqMissingLanguages")} {missing.map((l) => l.toUpperCase()).join(", ")}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-primary">{question}</p>
          <p className="mt-0.5 line-clamp-2 text-sm text-label">{answer}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
          <IconButton label={t("faqMoveUp")} disabled={index === 0 || busy} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton label={t("faqMoveDown")} disabled={last || busy} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </IconButton>
          <IconButton label={t("faqEdit")} onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton label={t("faqDelete")} onClick={() => setConfirming(true)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3" role="alertdialog" aria-label={t("faqDeleteConfirm")}>
          <p className="mr-auto text-sm text-primary">{t("faqDeleteConfirm")}</p>
          <Button
            size="sm"
            className="bg-error hover:bg-error/90"
            disabled={remove.isPending}
            onClick={() => {
              setFailed(false);
              remove.mutate(entry.id, { onError: () => setFailed(true) });
            }}
          >
            {t("faqDelete")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
      {failed ? <p className="mt-2 text-sm text-error">{t("faqActionFailed")}</p> : null}
    </li>
  );
}

function FaqForm({ id, initial, onDone }: { id?: string; initial: FaqDraft; onDone: () => void }) {
  const { t } = useLocale();
  const save = useSaveFaq();
  const [draft, setDraft] = useState(initial);
  // Start on the language that is already filled in (a draft from the chat).
  const [lang, setLang] = useState<Locale>(() => LANGUAGES.find((l) => initial.question[l.locale])?.locale ?? "en");
  const [error, setError] = useState<string>();
  const [tried, setTried] = useState(false);
  const missing = missingLanguages(draft);
  const formId = `faq-form-${id ?? "new"}`;

  function setText(field: "question" | "answer", value: string) {
    setDraft((d) => ({ ...d, [field]: { ...d[field], [lang]: value } }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (missing.length > 0) {
      setLang(missing[0]!);
      return;
    }
    setError(undefined);
    try {
      await save.mutateAsync({ id, draft });
      onDone();
    } catch (err) {
      setError(getErrorStatus(err) === 409 ? t("faqDuplicate") : t("faqSaveFailed"));
    }
  }

  return (
    <Card className="space-y-4 border-primary/20 p-4 md:p-5">
      <form id={formId} className="space-y-4" onSubmit={submit}>
        <div className="flex flex-wrap gap-1 rounded-xl bg-background-2 p-1" role="tablist">
          {LANGUAGES.map((l) => (
            <button
              key={l.locale}
              type="button"
              role="tab"
              aria-selected={lang === l.locale}
              onClick={() => setLang(l.locale)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold",
                lang === l.locale ? "bg-white text-primary shadow-sm" : "text-label hover:text-primary",
              )}
            >
              {l.name}
              {missing.includes(l.locale) ? (
                <span className={cn("h-1.5 w-1.5 rounded-full", tried ? "bg-error" : "bg-border")} aria-hidden />
              ) : null}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${formId}-q`} className="text-sm font-medium text-label">
            {t("faqQuestionLabel")} · {lang.toUpperCase()}
          </label>
          <input
            id={`${formId}-q`}
            value={draft.question[lang]}
            maxLength={200}
            onChange={(e) => setText("question", e.target.value)}
            className="flex h-11 w-full rounded-xl border border-border bg-white px-3.5 text-sm text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${formId}-a`} className="text-sm font-medium text-label">
            {t("faqAnswerLabel")} · {lang.toUpperCase()}
          </label>
          <textarea
            id={`${formId}-a`}
            value={draft.answer[lang]}
            maxLength={4000}
            rows={4}
            onChange={(e) => setText("answer", e.target.value)}
            className="w-full resize-y rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-label">
            {t("faqCategoryLabel")}
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as FaqDraft["category"] }))}
              className="h-9 rounded-xl border border-border bg-white px-2.5 text-sm text-primary focus-visible:border-primary focus-visible:outline-none"
            >
              {FAQ_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(FAQ_CATEGORY_KEY[c])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-primary">
            <input
              type="checkbox"
              checked={draft.pinned}
              onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))}
              className="h-4 w-4 accent-primary"
            />
            {t("faqPinnedLabel")}
          </label>
        </div>

        {tried && missing.length > 0 ? (
          <p className="text-sm text-error" role="alert">
            {t("faqAllLanguagesHint")} {t("faqMissingLanguages")} {missing.map((l) => l.toUpperCase()).join(", ")}
          </p>
        ) : (
          <p className="text-xs text-label">{t("faqAllLanguagesHint")}</p>
        )}
        {error ? (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {t("save")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function IconButton({ label, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className="rounded-lg p-1.5 text-label hover:bg-background-2 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
    />
  );
}
