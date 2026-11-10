import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// Intentionally separate from vite.config.ts: no Node bridge or local server plugins.
export default defineConfig({
  optimizeDeps: { include: ["@xterm/xterm", "@xterm/addon-fit"] },
  base: "./",
  plugins: [
    react(),
    tailwind(),
    {
      name: "workbench-demo-entry",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return html.replace('src="/src/main.tsx"', 'src="/src/demo/main.ts"');
        },
      },
    },
  ],
  build: { outDir: "dist/demo", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5182, strictPort: true },
  preview: { host: "127.0.0.1", port: 5182, strictPort: true },
});
