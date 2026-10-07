import { useAuth } from "@/app/AuthContext";
import { useLocale } from "@/i18n/LocaleContext";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo } from "./Logo";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BookOpen,
  MapPin,
  MessageSquare,
  Plus,
  Settings,
  GraduationCap,
  Home,
} from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";

const desktopNav = [
  { to: "/forum", key: "forum" as const, icon: MessageSquare },
  { to: "/faq", key: "faq" as const, icon: BookOpen },
  { to: "/navigation", key: "navigation" as const, icon: MapPin },
  { to: "/courses", key: "courses" as const, icon: GraduationCap },
  { to: "/settings", key: "settings" as const, icon: Settings },
];

export function AppShell() {
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const displayName = user?.name ?? "Student";

  return (
    <div className="flex min-h-dvh flex-col bg-[#f4f6fb] md:flex-row">
      <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r border-border/40 bg-white px-4 py-5 md:flex">
        <Logo />
        <Button
          variant="secondary"
          className="w-full justify-start bg-background-2 font-semibold text-primary hover:bg-background-2-hover"
          onClick={() => navigate("/chat")}
        >
          <Plus className="h-4 w-4" />
          {t("newChat")}
        </Button>
        <nav className="flex flex-col gap-1">
          {desktopNav.map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-primary/80 transition-colors hover:bg-background-2",
                  isActive && "bg-background-2 text-primary",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{t(key)}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border/40 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="md:hidden">
            <Logo />
          </div>
          <div className="hidden flex-1 md:block" />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <UserAvatar name={displayName} />
          </div>
        </header>

        <main className="flex-1 overflow-auto px-4 py-5 pb-24 md:px-6 md:pb-6">
          <Outlet />
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex items-end justify-around border-t border-border/50 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:hidden"
          aria-label="Main"
        >
          <MobileTab to="/" label={t("home")} icon={Home} />
          <MobileTab to="/forum" label={t("forum")} icon={MessageSquare} />
          <button
            type="button"
            onClick={() => navigate("/chat")}
            className="flex flex-col items-center gap-0.5 px-2"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-background-2 text-primary shadow-sm">
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-semibold text-primary">{t("newChat")}</span>
          </button>
          <MobileTab to="/faq" label={t("faq")} icon={BookOpen} />
          <MobileTab to="/settings" label={t("profile")} icon={Settings} />
        </nav>
      </div>
    </div>
  );
}

function MobileTab({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Home;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex min-w-[3.5rem] flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-semibold text-primary/60",
          isActive && "text-primary",
        )
      }
    >
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}
