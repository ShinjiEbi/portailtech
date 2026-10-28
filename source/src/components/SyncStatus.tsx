// Bouton de synchronisation : état réel (en cours / OK / erreurs / hors ligne / non connecté),
// nombre de modifications en attente, bilan de la dernière synchro (envoyés / reçus / erreurs).
// Synchro automatique : au retour du réseau, au retour sur l'appli, et toutes les 5 min.
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LAST_SYNC_REPORT, isOnline, pendingCount, syncAll, syncRunning, type SyncReport } from "../lib/sync";
import { metaGet } from "../lib/db";
import { supabase } from "../lib/supabase";

// Reconnexion sans déconnexion : les données locales (non synchronisées) sont conservées.
function Reauth({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(() => localStorage.getItem("portail-tech-email") ?? "");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr(error.message); else onDone();
  }
  return (
    <form className="reauth" onSubmit={go} onClick={(e) => e.stopPropagation()}>
      <div>Session expirée. Reconnecte-toi : <b>tes saisies hors-ligne sont conservées</b> et seront envoyées.</div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="username" required />
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe" autoComplete="current-password" required autoFocus />
      {err && <div className="sync-err">{err}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Connexion…" : "Se reconnecter et synchroniser"}</button>
    </form>
  );
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "jamais";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

export function SyncStatus() {
  const pending = useLiveQuery(() => pendingCount(), [], 0) ?? 0;
  const [online, setOnline] = useState(isOnline());
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<SyncReport | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const closeT = useRef<number>();

  async function run(show: boolean) {
    if (!isOnline()) { setOnline(false); if (show) setOpen(true); return; }
    setBusy(true);
    try {
      const r = await syncAll();
      setRep(r);
      if (r.status === "ok") setLastOk(r.at);
      if (show || r.status === "erreur" || r.status === "non_connecte") {
        setOpen(true);
        window.clearTimeout(closeT.current);
        if (r.status === "ok") closeT.current = window.setTimeout(() => setOpen(false), 3500);
      }
    } catch (e) {
      setRep({ at: new Date().toISOString(), status: "erreur", pushed: 0, pulled: 0, errors: [String(e)] });
      setOpen(true);
    } finally {
      setBusy(syncRunning());
    }
  }

  useEffect(() => {
    metaGet("last_sync").then(setLastOk);
    metaGet(LAST_SYNC_REPORT).then((s) => { try { if (s) setRep(JSON.parse(s)); } catch { /* ignore */ } });
    const on = () => { setOnline(true); run(false); };
    const off = () => setOnline(false);
    const vis = () => { if (document.visibilityState === "visible") run(false); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    const iv = window.setInterval(() => { tick((n) => n + 1); if (document.visibilityState === "visible") run(false); }, 5 * 60 * 1000);
    const iv2 = window.setInterval(() => tick((n) => n + 1), 30 * 1000); // rafraîchit « il y a … »
    run(false);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
      window.clearInterval(iv); window.clearInterval(iv2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = !online ? "off" : busy ? "busy" : rep?.status === "erreur" || rep?.status === "non_connecte" ? "err" : "ok";
  const label = !online ? "hors ligne" : busy ? "synchro…" : rep?.status === "non_connecte" ? "non connecté"
    : rep?.status === "erreur" ? "erreur" : timeAgo(lastOk);

  return (
    <div className="sync-wrap">
      <button className={`sync ${state}`} onClick={() => run(true)} disabled={busy} title="Synchroniser maintenant">
        <span className={`dot ${state}`} />
        <span className="sync-label">{label}</span>
        {pending > 0 && <span className="badge" title="Modifications en attente d'envoi">{pending}</span>}
      </button>
      {open && (
        <div className={`sync-pop ${state}`} onClick={() => setOpen(false)}>
          {!online ? (
            <div>Hors ligne : {pending} modification(s) en attente, envoi automatique au retour du réseau.</div>
          ) : rep?.status === "non_connecte" ? (
            <Reauth onDone={() => run(true)} />
          ) : rep ? (
            <>
              <div><b>{rep.status === "ok" ? "✓ Synchronisé" : "⚠ Synchro incomplète"}</b> · {new Date(rep.at).toLocaleTimeString("fr-FR")}</div>
              <div className="muted">↑ {rep.pushed} envoyé(s) · ↓ {rep.pulled} reçu(s) · {pending} en attente</div>
              {rep.errors.map((e, i) => <div key={i} className="sync-err">{e}</div>)}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
