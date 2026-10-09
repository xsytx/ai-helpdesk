import { useLocale } from "@/i18n/LocaleContext";

/** Shown while a page's code is being downloaded. */
export function PageLoading() {
  const { t } = useLocale();
  return (
    <p className="py-6 text-center text-sm text-label" role="status">
      {t("loading")}
    </p>
  );
}
