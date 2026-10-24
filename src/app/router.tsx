import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { ErrorPage, NotFoundPage } from "@/pages/ErrorPages";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { AppShell } from "@/shared/layout/AppShell";
import { PageLoading } from "@/shared/ui/PageLoading";
import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";

/**
 * Loads a page's code only when it's first opened. The login and home pages
 * are imported directly above, since nearly every visit starts on one of them.
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Page = lazy(async (): Promise<{ default: ComponentType }> => ({
    default: (await load())[name],
  }));
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    // A crash anywhere shows a friendly error page instead of a blank screen.
    errorElement: <ErrorPage />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/shared/:token", element: lazyPage(() => import("@/pages/SharedChatPage"), "SharedChatPage") },
      { path: "/signup", element: lazyPage(() => import("@/pages/SignUpPage"), "SignUpPage") },
      {
        path: "/forgot-password",
        element: lazyPage(() => import("@/pages/ForgotPasswordPage"), "ForgotPasswordPage"),
      },
      { path: "/verify", element: lazyPage(() => import("@/pages/VerifyCodePage"), "VerifyCodePage") },
      {
        path: "/reset-password",
        element: lazyPage(() => import("@/pages/ResetPasswordPage"), "ResetPasswordPage"),
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              {
                // Inside the app a crash replaces only the page; the sidebar stays.
                errorElement: <ErrorPage />,
                children: [
                  { index: true, element: <HomePage /> },
                  // One route for a new chat (/chat) and a saved one (/chat/12), so the page
                  // keeps its state (and a running question) when switching chats.
                  { path: "chat/:conversationId?", element: lazyPage(() => import("@/pages/ChatPage"), "ChatPage") },
                  { path: "forum", element: lazyPage(() => import("@/pages/ForumPage"), "ForumPage") },
                  { path: "users/:userId", element: lazyPage(() => import("@/pages/ProfilePage"), "ProfilePage") },
                  {
                    path: "forum/:threadId",
                    element: lazyPage(() => import("@/pages/ThreadDetailPage"), "ThreadDetailPage"),
                  },
                  {
                    path: "navigation",
                    element: <PlaceholderPage titleKey="navigation" descriptionKey="navigationSoon" />,
                  },
                  {
                    path: "courses",
                    element: <PlaceholderPage titleKey="courses" descriptionKey="coursesSoon" />,
                  },
                  {
                    // Admin panel; moderation is its first section.
                    path: "admin",
                    element: lazyPage(() => import("@/pages/ModerationPage"), "ModerationPage"),
                  },
                  { path: "moderation", element: <Navigate to="/admin" replace /> },
                  { path: "faq", element: lazyPage(() => import("@/pages/FaqPage"), "FaqPage") },
                  {
                    path: "settings",
                    element: lazyPage(() => import("@/pages/SettingsPage"), "SettingsPage"),
                  },
                  { path: "*", element: <NotFoundPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
