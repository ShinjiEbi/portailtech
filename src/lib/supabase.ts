import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Aide au dbogage si le .env n'est pas rempli
  console.warn("[Portail-tech] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants (.env)");
}

// La cl anon est PUBLIQUE par design : toute la scurit passe par les RLS.
// Ne jamais mettre la cl service_role dans le front.
export const supabase = createClient(url ?? "", anon ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "portail-tech-auth",
  },
});
