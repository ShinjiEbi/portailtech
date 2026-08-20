import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { syncAll, resetLocal } from "../lib/sync";

type Role = "tech" | "referent" | "admin";

interface AuthCtx {
  session: Session | null; // session live (sert à la synchro en ligne)
  authed: boolean;         // accès autorisé (en ligne via session, OU hors-ligne si déjà connecté)
  email: string | null;
  loading: boolean;
  role: Role;
  isReferent: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);
const ROLE_KEY = "portail-tech-role";
const AUTHED_KEY = "portail-tech-authed"; // "1" dès qu'on s'est connecté une fois
const EMAIL_KEY = "portail-tech-email";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Accès optimiste : si on s'est déjà connecté, on reste accessible hors-ligne.
  const [authed, setAuthed] = useState<boolean>(() => localStorage.getItem(AUTHED_KEY) === "1");
  const [email, setEmail] = useState<string | null>(() => localStorage.getItem(EMAIL_KEY));
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role>(() => (localStorage.getItem(ROLE_KEY) as Role) || "tech");
  const intentionalLogout = useRef(false);

  function markAuthed(s: Session) {
    setSession(s);
    setAuthed(true);
    localStorage.setItem(AUTHED_KEY, "1");
    if (s.user.email) {
      setEmail(s.user.email);
      localStorage.setItem(EMAIL_KEY, s.user.email);
    }
  }

  async function refreshRole(uid: string) {
    try {
      const { data } = await supabase.from("profiles").select("role").eq("id", uid).single();
      if (data?.role) {
        setRole(data.role as Role);
        localStorage.setItem(ROLE_KEY, data.role as string);
      }
    } catch {
      /* hors-ligne : on garde le rôle en cache */
    }
  }

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setLoading(false);
      }
    };
    // Garde-fou : ne jamais rester bloqué sur le splash (réseau lent / hors-ligne).
    const t = setTimeout(finish, 2500);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) {
          markAuthed(data.session);
          refreshRole(data.session.user.id);
          syncAll().catch(console.error);
        }
        // Pas de session : on ne TOUCHE PAS à `authed`. Si on s'était déjà
        // connecté (marqueur présent), l'accès reste ouvert (utile hors-ligne et
        // sur connexion instable). Seul un logout explicite ferme l'accès.
      })
      .catch(() => {
        /* getSession a échoué (réseau) : on garde l'accès si le marqueur est là */
      })
      .finally(finish);

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (s) {
        markAuthed(s);
        refreshRole(s.user.id);
        return;
      }
      // Session devenue nulle. Si c'est un logout volontaire, signOut() s'en charge.
      // Sinon (typiquement un refresh de token qui échoue hors-ligne), on NE
      // déconnecte PAS l'accès local ; on met juste la session live à null.
      if (!intentionalLogout.current) setSession(null);
    });

    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(emailArg: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: emailArg, password });
    if (error) return { error: error.message };
    syncAll().catch(console.error);
    return { error: null };
  }

  async function signOut() {
    intentionalLogout.current = true;
    setAuthed(false);
    setSession(null);
    setEmail(null);
    setRole("tech");
    localStorage.removeItem(AUTHED_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(ROLE_KEY);
    try {
      await supabase.auth.signOut();
    } catch {
      /* hors-ligne : la session locale supabase sera de toute façon effacée */
    }
    await resetLocal();
    intentionalLogout.current = false;
  }

  return (
    <Ctx.Provider
      value={{
        session,
        authed,
        email,
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
  if (!c) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return c;
}
