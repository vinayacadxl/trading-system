import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function serveStatic(app: Express) {
    // In production, esbuild puts index.js in dist/
    // Vite puts frontend in dist/public/
    const distPath = path.resolve(__dirname, "public");

    if (!fs.existsSync(distPath)) {
        // Fallback for dev if needed, or structured logging
        const devPath = path.resolve(__dirname, "../client");
        if (fs.existsSync(devPath)) {
            app.use(express.static(devPath));
            app.use((_req, res) => res.sendFile(path.resolve(devPath, "index.html")));
            return;
        }
        throw new Error(`Could not find static files at ${distPath}`);
    }

    app.use(express.static(distPath));

    app.use((_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
    });
}
