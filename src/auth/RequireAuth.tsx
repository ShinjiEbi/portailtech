import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="splash">…</div>;
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}
