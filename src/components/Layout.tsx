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
        <NavLink to="/imputations" className="tab">
          <span className="tab-ico">⏱</span>Imputations
        </NavLink>
        <NavLink to="/journal" className="tab">
          <span className="tab-ico">▤</span>Journal
        </NavLink>
      </nav>
    </div>
  );
}
