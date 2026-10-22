import { ChatPage } from "@/pages/ChatPage";
import { FaqPage } from "@/pages/FaqPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ForumPage } from "@/pages/ForumPage";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { ModerationPage } from "@/pages/ModerationPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SignUpPage } from "@/pages/SignUpPage";
import { ThreadDetailPage } from "@/pages/ThreadDetailPage";
import { VerifyCodePage } from "@/pages/VerifyCodePage";
import { AppShell } from "@/shared/layout/AppShell";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignUpPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/verify", element: <VerifyCodePage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "chat", element: <ChatPage /> },
          { path: "forum", element: <ForumPage /> },
          { path: "forum/:threadId", element: <ThreadDetailPage /> },
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
          { path: "moderation", element: <ModerationPage /> },
          { path: "faq", element: <FaqPage /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
