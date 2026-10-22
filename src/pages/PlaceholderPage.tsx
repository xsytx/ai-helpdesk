import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { Card } from "@/shared/ui/Card";

/** A section that isn't built yet; title and text follow the chosen language. */
export function PlaceholderPage({
  titleKey,
  descriptionKey,
}: {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
}) {
  const { t } = useLocale();
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <h1 className="text-xl font-bold text-primary">{t(titleKey)}</h1>
        <p className="mt-2 text-sm text-label">{t(descriptionKey)}</p>
      </Card>
    </div>
  );
}
