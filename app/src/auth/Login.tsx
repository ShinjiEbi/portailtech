import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function Login() {
  const { signIn, authed } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: { pathname?: string } } };
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (authed) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setErr("Hors-ligne : la première connexion sur cet appareil nécessite internet.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await signIn(email.trim(), pw);
    setBusy(false);
    if (error) setErr(error);
    else nav(loc.state?.from?.pathname ?? "/", { replace: true });
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">PT</div>
        <h1>Portail-tech</h1>
        <p className="muted">Outils radioprotection terrain</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {err && <div className="error">{err}</div>}
        <button type="submit" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
