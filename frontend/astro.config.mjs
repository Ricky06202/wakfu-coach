import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  site: "http://localhost:3000",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        // En desarrollo la API corre en :3000; el dev server de Astro reenvía /api.
        "/api": "http://localhost:3000",
      },
    },
  },
});
