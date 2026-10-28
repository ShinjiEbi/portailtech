import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { SyncStatus } from "./SyncStatus";
import { lastPathOf, rememberPath, rememberScroll, scrollOf } from "../lib/memo";

const TABS = ["/ecme", "/materiels", "/interventions", "/calcul", "/planning", "/parametrage", "/rtr"];
const tabOf = (path: string) => TABS.find((t) => path === t || path.startsWith(t + "/"));

// Onglet qui rouvre la dernière page visitée dans cette section ; re-toucher l'onglet
// alors qu'on y est déjà ramène à sa page d'accueil.
function TabLink({ to, className, title, children }: { to: string; className: string; title?: string; children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const here = tabOf(loc.pathname) === to;
  const target = here ? to : lastPathOf(to) ?? to;
  return (
    <NavLink to={target} className={({ isActive }) => `${className}${isActive || here ? " active" : ""}`} title={title}
      onClick={(e) => { if (here && loc.pathname !== to) { e.preventDefault(); nav(to); } }}>
      {children}
    </NavLink>
  );
}

// Mémorise la page de chaque onglet et la position de défilement de chaque page.
function useNavMemory() {
  const loc = useLocation();
  const path = loc.pathname + loc.search;
  const cur = useRef(path);
  useEffect(() => {
    cur.current = path;
    const tab = tabOf(loc.pathname);
    if (tab) rememberPath(tab, path);
    // restauration du défilement (réessaie le temps que le contenu se charge)
    const y = scrollOf(path);
    let n = 0;
    const tick = () => {
      if (cur.current !== path) return;
      window.scrollTo(0, y);
      if (Math.abs(window.scrollY - y) > 4 && n++ < 20) window.setTimeout(tick, 80);
    };
    tick();
  }, [path, loc.pathname]);
  useEffect(() => {
    let t = 0;
    const on = () => { window.clearTimeout(t); t = window.setTimeout(() => rememberScroll(cur.current, window.scrollY), 120); };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
}

export function Layout() {
  const { signOut } = useAuth();
  useNavMemory();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⬡</span> Portail-tech
        </div>
        <div className="topbar-right">
          <TabLink to="/rtr" className="rtr-btn" title="Bibliothèque IZ (RTR)">
            ☢<span className="rtr-btn-lbl">IZ</span>
          </TabLink>
          <SyncStatus />
          <button className="ghost" onClick={signOut} title="Déconnexion">
            ⏻
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <nav className="tabbar">
        <TabLink to="/ecme" className="tab">
          <span className="tab-ico">⬡</span>ECME
        </TabLink>
        <TabLink to="/materiels" className="tab">
          <span className="tab-ico">▤</span>Matériels
        </TabLink>
        <TabLink to="/interventions" className="tab">
          <span className="tab-ico">☑</span>Interv.
        </TabLink>
        <TabLink to="/calcul" className="tab">
          <span className="tab-ico">ƒ</span>Calcul
        </TabLink>
        <TabLink to="/planning" className="tab">
          <span className="tab-ico">▦</span>Planning
        </TabLink>
        <TabLink to="/parametrage" className="tab">
          <span className="tab-ico">⚙</span>Paramétrage
        </TabLink>
      </nav>
    </div>
  );
}
