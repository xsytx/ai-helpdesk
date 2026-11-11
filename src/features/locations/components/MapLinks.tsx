// "Show on map" under an AI answer: the rooms and places the question asked
// about, each opening the Maps page with the route and the floor plan.
import { useLocale } from "@/i18n/LocaleContext";
import { MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { findMapTargets } from "../mapLinks";

export function MapLinks({ text }: { text: string }) {
  const { t, locale } = useLocale();
  const targets = findMapTargets(text, locale);
  if (targets.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {targets.map((target) => (
        <Link
          key={target.code}
          viewTransition
          to={target.to}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-primary hover:bg-background-2"
        >
          <MapPin className="h-3.5 w-3.5 text-accent" />
          {t("chatShowOnMap").replace("{name}", target.label)}
        </Link>
      ))}
    </div>
  );
}
