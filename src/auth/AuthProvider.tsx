import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { syncAll, resetLocal } from "../lib/sync";

type Role = "tech" | "referent" | "admin";

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  role: Role;
  isReferent: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);
const ROLE_KEY = "portail-tech-role";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Rle mis en cache pour rester fonctionnel hors-ligne
  const [role, setRole] = useState<Role>(
    () => (localStorage.getItem(ROLE_KEY) as Role) || "tech"
  );

  async function refreshRole(uid: string) {
    const { data } = await supabase.from("profiles").select("role").eq("id", uid).single();
    if (data?.role) {
      setRole(data.role as Role);
      localStorage.setItem(ROLE_KEY, data.role);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) {
        refreshRole(data.session.user.id);
        syncAll().catch(console.error);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (s) refreshRole(s.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    syncAll().catch(console.error);
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    localStorage.removeItem(ROLE_KEY);
    await resetLocal();
    setRole("tech");
  }

  return (
    <Ctx.Provider
      value={{
        session,
        loading,
        role,
        isReferent: role === "referent" || role === "admin",
        signIn,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth doit tre utilis dans <AuthProvider>");
  return c;
}
