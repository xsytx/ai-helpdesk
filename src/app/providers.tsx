import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./AuthContext";
import { LocaleProvider } from "@/i18n/LocaleContext";
import { ThemeProvider } from "@/shared/lib/theme";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    // Data counts as fresh for 20 s, so moving between pages doesn't refetch
    // everything; pages that must stay current poll on their own interval.
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 20_000 },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
