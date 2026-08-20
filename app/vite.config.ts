import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Dépôt GitHub Pages "projet" (https://shinjiebi.github.io/portailtech/) :
// builder avec  VITE_BASE=/portailtech/  . Sinon racine "/".
const base = process.env.VITE_BASE ?? "/";

// GitHub Pages n'a pas de réécriture SPA : un rafraîchissement sur /…/planning
// renvoie un 404. On publie donc 404.html = copie d'index.html ; GitHub le sert
// pour toute URL inconnue, l'appli démarre et React Router affiche la bonne page.
function spaFallback404(): Plugin {
  let outDir = "dist";
  return {
    name: "emit-404-html",
    apply: "build",
    configResolved(c: ResolvedConfig) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const index = resolve(outDir, "index.html");
      if (existsSync(index)) copyFileSync(index, resolve(outDir, "404.html"));
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Portail-tech",
        short_name: "Portail-tech",
        description: "Outils radioprotection terrain (offline-first)",
        // Indispensable en sous-dossier : sinon l'appli installée ouvre "/" (404).
        id: base,
        scope: base,
        start_url: base,
        theme_color: "#0e1216",
        background_color: "#0e1216",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        // Repli de navigation tenant compte du sous-dossier (rechargement
        // hors-ligne sur n'importe quelle page de l'appli).
        navigateFallback: base + "index.html",
        // …sauf l'ancien outil autonome, qui doit rester ouvrable tel quel.
        navigateFallbackDenylist: [/planning-legacy\.html$/],
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,png,svg,woff2,xlsx,xlsm}"]
      }
    }),
    spaFallback404()
  ]
});
