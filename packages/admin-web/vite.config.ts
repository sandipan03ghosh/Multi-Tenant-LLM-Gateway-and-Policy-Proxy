import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Browser-based Admin UI — a plain Vite+React SPA, no SSR. `vite build` produces a static dist/,
// deployable independently of the api process.
export default defineConfig({
  plugins: [react()],
});
