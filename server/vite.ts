import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  // /api requests ko Vite/catch-all se skip karo – API routes handle karenge
  const isApiRequest = (req: { path?: string; originalUrl?: string }) =>
    (req.originalUrl || req.path || "").startsWith("/api");
  app.use((req, res, next) => {
    if (isApiRequest(req)) return next();
    vite.middlewares(req, res, next);
  });

  // Catch-all for SPA: only serve HTML for non-API (API must never get HTML).
  app.use(async (req, res, next) => {
    const pathname = (req.originalUrl || req.path || "").split("?")[0];
    if (pathname.startsWith("/api")) {
      return res.status(404).set("Content-Type", "application/json").json({ success: false, error: "API route not found" });
    }
    const url = req.originalUrl || req.path || "/";

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
