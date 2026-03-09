import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@shared/schema';
import 'dotenv/config';

let dbInstance: any = null;
let poolInstance: any = null;

try {
    if (process.env.DATABASE_URL) {
        poolInstance = new pg.Pool({
            connectionString: process.env.DATABASE_URL,
            max: 1,
            idleTimeoutMillis: 30000,
        });
        dbInstance = drizzle(poolInstance, { schema });
        console.log("📂 Database connection initialized (Optional Mode)");
    } else {
        console.warn("⚠️ DATABASE_URL not set. Running in memory-only mode.");
    }
} catch (e) {
    console.error("❌ Database initialization failed, continuing without DB:", e);
}

export const pool = poolInstance;
export const db = dbInstance;
