import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
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
  { path: "/login", element: <LoginPage /> },
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
          { index: true, element: <HomePage /> },
          { path: "chat", element: lazyPage(() => import("@/pages/ChatPage"), "ChatPage") },
          { path: "forum", element: lazyPage(() => import("@/pages/ForumPage"), "ForumPage") },
          {
            path: "forum/:threadId",
            element: lazyPage(() => import("@/pages/ThreadDetailPage"), "ThreadDetailPage"),
          },
          {
            path: "navigation",
            element: (
              <PlaceholderPage
                title="Campus maps"
                description="Search rooms by name with text and photo results."
              />
            ),
          },
          {
            path: "courses",
            element: (
              <PlaceholderPage
                title="Courses"
                description="Course descriptions by semester and student reviews."
              />
            ),
          },
          {
            path: "admin",
            element: (
              <PlaceholderPage
                title="Admin"
                description="FAQ and location CRUD for administrators."
              />
            ),
          },
          { path: "faq", element: lazyPage(() => import("@/pages/FaqPage"), "FaqPage") },
          {
            path: "settings",
            element: lazyPage(() => import("@/pages/SettingsPage"), "SettingsPage"),
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
