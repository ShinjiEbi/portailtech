import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./auth/RequireAuth";
import Login from "./auth/Login";
import { EtalonsList } from "./modules/ecme/EtalonsList";
import { EtalonDetail } from "./modules/ecme/EtalonDetail";
import { ImputationsView } from "./modules/imputations/ImputationsView";
import { JournalView } from "./modules/journal/JournalView";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/ecme" replace />} />
        <Route path="ecme" element={<EtalonsList />} />
        <Route path="ecme/:id" element={<EtalonDetail />} />
        <Route path="imputations" element={<ImputationsView />} />
        <Route path="journal" element={<JournalView />} />
        <Route path="*" element={<Navigate to="/ecme" replace />} />
      </Route>
    </Routes>
  );
}
