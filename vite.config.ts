import { Server } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { attachBridge } from "./server/bridge";
import { SECURITY_HEADERS } from "./server/security-headers";
import { serveCodexRelease } from "./server/codex-release";
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    {
      name: "codex-bridge",
      configureServer(server) {
        if (!(server.httpServer instanceof Server))
          throw new Error("Codex Workbench requires a local HTTP server.");
        attachBridge(server.httpServer);
        const httpServer = server.httpServer;
        server.middlewares.use((req, res, next) => {
          if (req.url === "/codex-release")
            void serveCodexRelease(httpServer, req, res);
          else next();
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    headers: SECURITY_HEADERS,
  },
  build: { outDir: "dist/client", manifest: true },
});
