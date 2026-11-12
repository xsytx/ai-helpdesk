// Admin, map editor: students' photo suggestions, and bulk upload of many
// photos named by room code (F205.jpg → room F205).
import { PHOTO_TYPES } from "@/features/forum/api";
import { checkPhotos, Lightbox } from "@/features/forum/components/Photos";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { getErrorStatus } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { ImagePlus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MapPoint } from "../mapPoints";
import {
  MAX_PLACE_PHOTOS, bulkPhotoTarget, useApproveLocationPhoto, useDeleteLocationPhoto, usePhotoSuggestions, useUploadLocationPhoto,
} from "../photos";

/** Students' photo suggestions: add one to its place's gallery or remove it. */
export function PhotoSuggestions({ placeName }: { placeName: (code: string) => string }) {
  const { t, locale } = useLocale();
  const { data } = usePhotoSuggestions();
  const approve = useApproveLocationPhoto();
  const remove = useDeleteLocationPhoto();
  const [open, setOpen] = useState<number | null>(null);
  const [problem, setProblem] = useState<string>();
  const list = data ?? [];
  const busy = approve.isPending || remove.isPending;
  const failed = (err: unknown) =>
    setProblem(getErrorStatus(err) === 409 ? t("mapPhotosFull").replace("{n}", String(MAX_PLACE_PHOTOS)) : t("mapPhotosFailed"));

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-label">
        {t("mapPhotoSuggestions")} ({list.length})
      </h3>
      {list.length === 0 ? <p className="text-sm text-label">{t("mapPhotoSuggestionsEmpty")}</p> : null}
      <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1 lg:max-h-[300px]">
        {list.map((p, i) => (
          <li key={p.id} className="flex gap-2.5 rounded-xl border border-border bg-surface p-2.5 text-sm">
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={t("photoOpen")}
              className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-background-2"
            >
              <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-primary">
                {placeName(p.placeCode)} <span className="font-mono text-xs font-normal text-label">{p.placeCode}</span>
              </p>
              <p className="text-xs text-label">
                {p.uploaderName} · {formatRelativeTime(p.createdAt, locale)}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2.5"
                  disabled={busy}
                  onClick={() => {
                    setProblem(undefined);
                    approve.mutate({ id: p.id }, { onError: failed });
                  }}
                >
                  <ImagePlus className="h-4 w-4" />
                  {t("mapReportPhotoApprove")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 px-0"
                  disabled={busy}
                  aria-label={t("mapReportPhotoRemove")}
                  title={t("mapReportPhotoRemove")}
                  onClick={() => {
                    setProblem(undefined);
                    remove.mutate(p.id, { onError: failed });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {problem ? <p className="mt-1 text-xs text-error" role="alert">{problem}</p> : null}
      {open !== null && list[open] ? <Lightbox photos={list} start={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

type BulkStatus = "ready" | "uploading" | "done" | "full" | "failed" | "nomatch" | "bad";
interface BulkItem {
  file: File;
  target: { code: string; label: string } | null;
  status: BulkStatus;
  problem?: TranslationKey;
}

/**
 * Many photos at once, each to the room or place named in its file name
 * (F205.jpg, F205-2.jpg, RED_CANTEEN.jpg). Files without a code are listed
 * and skipped; a place that is full is reported per file.
 */
export function BulkPhotoUpload({ points, onClose }: { points: MapPoint[]; onClose: () => void }) {
  const { t } = useLocale();
  const upload = useUploadLocationPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Stop the queue when the panel closes.
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  const add = (files: File[]) => {
    setItems((prev) => [
      ...prev,
      ...files
        .filter((f) => !prev.some((i) => i.file.name === f.name && i.file.size === f.size))
        .map((file): BulkItem => {
          const { ok, problem } = checkPhotos([file], 1);
          const target = bulkPhotoTarget(file.name, points);
          if (!ok[0]) return { file, target, status: "bad", problem };
          return { file, target, status: target ? "ready" : "nomatch" };
        }),
    ]);
  };

  const run = async () => {
    setRunning(true);
    const queue = items.map((item, i) => ({ item, i })).filter(({ item }) => item.status === "ready" && item.target);
    for (const { item, i } of queue) {
      if (stopped.current) return;
      setItems((prev) => prev.map((x, j) => (j === i ? { ...x, status: "uploading" } : x)));
      let status: BulkStatus = "done";
      try {
        await upload.mutateAsync({ placeCode: item.target!.code, file: item.file });
      } catch (err) {
        status = getErrorStatus(err) === 409 ? "full" : "failed";
      }
      setItems((prev) => prev.map((x, j) => (j === i ? { ...x, status } : x)));
    }
    setRunning(false);
  };

  const ready = items.filter((i) => i.status === "ready").length;
  const done = items.filter((i) => i.status === "done").length;
  const notDone = items.length - ready - done - items.filter((i) => i.status === "uploading").length;
  const finished = !running && items.length > 0 && ready === 0;
  const label: Record<BulkStatus, string> = {
    ready: "",
    uploading: t("photoUploading"),
    done: t("mapBulkDone"),
    full: t("mapBulkFull"),
    failed: t("mapBulkFailed"),
    nomatch: t("mapBulkNoMatch"),
    bad: t("mapBulkFailed"),
  };

  return (
    <section className="space-y-2.5 rounded-2xl border border-border bg-surface p-3" aria-label={t("mapBulkTitle")}>
      <div className="flex items-center justify-between">
        <p className="font-semibold text-primary">{t("mapBulkTitle")}</p>
        <button
          type="button"
          onClick={onClose}
          disabled={running}
          aria-label={t("close")}
          className="rounded-lg p-1 text-label hover:bg-background-2 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-label">{t("mapBulkHint")}</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!running) add([...e.dataTransfer.files]);
        }}
        className={cn(
          "flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-4 text-center",
          dragging ? "border-brand bg-background-2" : "border-border",
        )}
      >
        <Button size="sm" variant="secondary" disabled={running} onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" />
          {t("mapBulkChoose")}
        </Button>
        <span className="text-xs text-label">{t("mapBulkDrop")}</span>
        <input
          ref={input}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {items.length > 0 ? (
        <ul className="max-h-[280px] space-y-1 overflow-y-auto pr-1 text-xs">
          {items.map((item, i) => (
            <li key={`${item.file.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-background-2/60 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-primary" title={item.file.name}>{item.file.name}</span>
              {item.target ? <span className="shrink-0 font-mono font-semibold text-primary">→ {item.target.label}</span> : null}
              {item.status !== "ready" ? (
                <span className={cn("shrink-0", item.status === "done" ? "text-green-700" : item.status === "uploading" ? "text-label" : "text-error")}>
                  {item.status === "bad" && item.problem ? t(item.problem) : label[item.status]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {finished ? (
        <p className="text-xs text-label" role="status">
          {t("mapBulkSummary").replace("{ok}", String(done)).replace("{bad}", String(notDone))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={running || ready === 0} onClick={() => void run()}>
          <Upload className="h-4 w-4" />
          {running ? t("photoUploading") : t("mapBulkUpload").replace("{n}", String(ready))}
        </Button>
        {items.length > 0 ? (
          <Button size="sm" variant="ghost" disabled={running} onClick={() => setItems([])}>
            {t("mapBulkClear")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
