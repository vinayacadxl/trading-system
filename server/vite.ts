import { type Express } from "express";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { log } from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function setupVite(app: Express, server: any) {
    const vite = await createViteServer({
        server: {
            middlewareMode: true,
            hmr: { server }
        },
        appType: "spa",
        configFile: path.resolve(__dirname, "../vite.config.ts"),
    });

    app.use(vite.middlewares);
    log("Vite dev middleware attached.");
    return vite;
}
