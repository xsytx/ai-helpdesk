import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { AlertTriangle, Home, RefreshCw, SearchX } from "lucide-react";
import { useEffect } from "react";
import { Link, useRouteError } from "react-router-dom";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">{children}</Card>
    </div>
  );
}

/**
 * Shown instead of a blank white screen when a page crashes. Inside the app
 * the sidebar stays; only the page area is replaced.
 */
export function ErrorPage() {
  const error = useRouteError();
  const { t } = useLocale();
  // After a new deploy, an old tab may ask for page files that no longer
  // exist — reloading fetches the new ones.
  const staleBuild = error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Centered>
      <AlertTriangle className="mx-auto h-10 w-10 text-accent" aria-hidden />
      <h1 className="mt-3 text-lg font-bold text-primary">{t("errorTitle")}</h1>
      <p className="mt-1 text-sm text-label">{staleBuild ? t("errorNewVersion") : t("errorBody")}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4" />
          {t("reloadPage")}
        </Button>
        <Button asChild size="sm" variant="secondary">
          <a href="/">
            <Home className="h-4 w-4" />
            {t("goHome")}
          </a>
        </Button>
      </div>
    </Centered>
  );
}

export function NotFoundPage() {
  const { t } = useLocale();
  return (
    <Centered>
      <SearchX className="mx-auto h-10 w-10 text-primary-light" aria-hidden />
      <h1 className="mt-3 text-lg font-bold text-primary">{t("notFoundTitle")}</h1>
      <p className="mt-1 text-sm text-label">{t("notFoundBody")}</p>
      <Button asChild size="sm" className="mt-5">
        <Link viewTransition to="/">
          <Home className="h-4 w-4" />
          {t("goHome")}
        </Link>
      </Button>
    </Centered>
  );
}
