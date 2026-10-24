import { useLocale } from "@/i18n/LocaleContext";
import type { Locale } from "@/i18n/translations";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/cn";

const labels: Record<Locale, string> = {
  en: "EN",
  kz: "KZ",
  ru: "RU",
};

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-tour="language"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary hover:bg-background-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-label="Language"
        >
          {labels[locale]}
          <ChevronDown className="h-4 w-4 opacity-70" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[4.5rem] rounded-xl border border-border bg-surface p-1 shadow-lg"
          sideOffset={6}
          align="end"
        >
          {(Object.keys(labels) as Locale[]).map((code) => (
            <DropdownMenu.Item
              key={code}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-primary outline-none",
                "focus:bg-background-2 data-[highlighted]:bg-background-2",
                code === locale && "bg-background-2",
              )}
              onSelect={() => setLocale(code)}
            >
              {labels[code]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
