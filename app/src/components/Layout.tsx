import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { SyncStatus } from "./SyncStatus";

export function Layout() {
  const { signOut } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⬡</span> Portail-tech
        </div>
        <div className="topbar-right">
          <NavLink to="/rtr" className="ghost" title="Régimes de travail radiologique">
            ☢
          </NavLink>
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
        <NavLink to="/ecme" className="tab">
          <span className="tab-ico">⬡</span>ECME
        </NavLink>
        <NavLink to="/materiels" className="tab">
          <span className="tab-ico">▤</span>Matériels
        </NavLink>
        <NavLink to="/interventions" className="tab">
          <span className="tab-ico">☑</span>Interv.
        </NavLink>
        <NavLink to="/calcul" className="tab">
          <span className="tab-ico">ƒ</span>Calcul
        </NavLink>
        <NavLink to="/planning" className="tab">
          <span className="tab-ico">▦</span>Planning
        </NavLink>
        <NavLink to="/parametrage" className="tab">
          <span className="tab-ico">⚙</span>Paramétrage
        </NavLink>
      </nav>
    </div>
  );
}
