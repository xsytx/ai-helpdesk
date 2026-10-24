import { LanguageSwitcher } from "@/shared/layout/LanguageSwitcher";
import { Logo } from "@/shared/layout/Logo";
import { ThemeToggle } from "@/shared/layout/ThemeToggle";
import type { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-4 md:px-8">
        <Logo to="/login" />
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-[400px] rounded-2xl bg-surface p-6 shadow-md [view-transition-name:page] md:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
