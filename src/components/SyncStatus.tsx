import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { pendingCount, syncAll, isOnline } from "../lib/sync";
import { metaGet, metaSet } from "../lib/db";

function timeAgo(iso: string | null): string {
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
  const [last, setLast] = useState<string | null>(null);

  async function doSync() {
    if (busy || !isOnline()) return;
    setBusy(true);
    try {
      await syncAll();
      const now = new Date().toISOString();
      await metaSet("last_sync", now);
      setLast(now);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    metaGet("last_sync").then(setLast);
    const on = () => {
      setOnline(true);
      doSync();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      className={`sync ${online ? "ok" : "off"}`}
      onClick={doSync}
      disabled={busy}
      title="Synchroniser"
    >
      <span className={`dot ${online ? "ok" : "off"} ${busy ? "spin" : ""}`} />
      <span className="sync-label">
        {!online ? "hors ligne" : busy ? "synchro…" : timeAgo(last)}
      </span>
      {pending > 0 && <span className="badge">{pending}</span>}
    </button>
  );
}
