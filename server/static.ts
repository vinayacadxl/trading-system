import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function serveStatic(app: Express) {
    const distPath = path.resolve(__dirname, "../client");

    if (!fs.existsSync(distPath)) {
        throw new Error(`Could not find static files at ${distPath}`);
    }

    app.use(express.static(distPath));

    app.use((_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
    });
}
