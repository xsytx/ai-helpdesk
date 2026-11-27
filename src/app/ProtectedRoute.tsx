import { useAuth } from "@/app/AuthContext";
import { clearReturnTo, rememberReturnTo } from "@/features/auth/returnTo";
import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  // Logged in earlier in this visit = a logout, not a link opened while
  // logged out: then the next login starts on the home page.
  const wasLoggedIn = useRef(isAuthenticated);
  if (isAuthenticated) wasLoggedIn.current = true;

  useEffect(() => {
    if (isAuthenticated) clearReturnTo();
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    if (!wasLoggedIn.current) rememberReturnTo(location.pathname + location.search + location.hash);
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
