import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./auth/RequireAuth";
import Login from "./auth/Login";
import { EtalonsList } from "./modules/ecme/EtalonsList";
import { EtalonForm } from "./modules/ecme/EtalonForm";
import { ModelesView } from "./modules/parametrage/ModelesView";
import { ModeleForm } from "./modules/parametrage/ModeleForm";
import PlanningView from "./modules/planning/PlanningView";
import { MateriauxView } from "./modules/materiels/MateriauxView";
import { MaterielForm } from "./modules/materiels/MaterielForm";
import { CalculsView } from "./modules/calcul/CalculsView";
import { CalculForm } from "./modules/calcul/CalculForm";
import { CalculRun } from "./modules/calcul/CalculRun";
import { DecroissanceView } from "./modules/calcul/DecroissanceView";
import { InterventionsView } from "./modules/intervention/InterventionsView";
import { ListingForm } from "./modules/intervention/ListingForm";
import { ListingView } from "./modules/intervention/ListingView";
import { RtrView } from "./modules/rtr/RtrView";

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
        <Route path="ecme/:id" element={<EtalonForm />} />
        <Route path="planning" element={<PlanningView />} />
        <Route path="materiels" element={<MateriauxView />} />
        <Route path="materiels/:scan" element={<MaterielForm />} />
        <Route path="calcul" element={<CalculsView />} />
        <Route path="calcul/new" element={<CalculForm />} />
        <Route path="calcul/decroissance" element={<DecroissanceView />} />
        <Route path="calcul/:id/edit" element={<CalculForm />} />
        <Route path="calcul/:id" element={<CalculRun />} />
        <Route path="interventions" element={<InterventionsView />} />
        <Route path="interventions/new" element={<ListingForm />} />
        <Route path="interventions/:id/edit" element={<ListingForm />} />
        <Route path="interventions/:id" element={<ListingView />} />
        <Route path="rtr" element={<RtrView />} />
        <Route path="parametrage" element={<ModelesView />} />
        <Route path="parametrage/:id" element={<ModeleForm />} />
        <Route path="*" element={<Navigate to="/ecme" replace />} />
      </Route>
    </Routes>
  );
}
