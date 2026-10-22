import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppProviders } from "@/app/providers";
import { router } from "@/app/router";
import { cleanupLegacyStorage } from "@/shared/lib/legacyStorage";
// Inter is bundled with the app (no Google Fonts request); the browser only
// downloads the alphabet subsets a page actually uses (Latin, Cyrillic incl. Kazakh).
import "@fontsource-variable/inter";
import "@/styles/globals.css";

cleanupLegacyStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
