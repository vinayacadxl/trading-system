import fs from "fs";
import path from "path";

// Debug log directory
const DEBUG_LOG_DIR = path.resolve(process.cwd(), "debug-logs");
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Ensure debug log directory exists
if (!fs.existsSync(DEBUG_LOG_DIR)) {
    fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true });
}

// Log categories
export type LogCategory =
    | "ai_decision"
    | "order_execution"
    | "risk_engine"
    | "error"
    | "websocket_health"
    | "data_source";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

interface LogEntry {
    timestamp: string;
    timestampMs: number;
    category: LogCategory;
    level: LogLevel;
    message: string;
    data?: Record<string, unknown>;
}

// Color codes for console
const COLORS = {
    INFO: "\x1b[36m",    // Cyan
    WARN: "\x1b[33m",    // Yellow
    ERROR: "\x1b[31m",   // Red
    DEBUG: "\x1b[90m",   // Gray
    RESET: "\x1b[0m",
};

const CATEGORY_COLORS = {
    ai_decision: "\x1b[35m",      // Magenta
    order_execution: "\x1b[32m",  // Green
    risk_engine: "\x1b[33m",      // Yellow
    error: "\x1b[31m",            // Red
    websocket_health: "\x1b[36m", // Cyan
    data_source: "\x1b[34m",      // Blue
};

/**
 * Log to both console and JSON file
 */
export function debugLog(
    category: LogCategory,
    message: string | Record<string, unknown>,
    level: LogLevel = "INFO"
): void {
    const timestamp = new Date().toISOString();
    const timestampMs = Date.now();

    let messageStr: string;
    let data: Record<string, unknown> | undefined;

    if (typeof message === "string") {
        messageStr = message;
    } else {
        messageStr = message.message as string || category;
        data = message;
    }

    const entry: LogEntry = {
        timestamp,
        timestampMs,
        category,
        level,
        message: messageStr,
        data,
    };

    // Console output with colors
    const levelColor = COLORS[level] || COLORS.INFO;
    const categoryColor = CATEGORY_COLORS[category] || COLORS.RESET;
    const resetColor = COLORS.RESET;

    console.log(
        `${levelColor}[${level}]${resetColor} ${categoryColor}[${category}]${resetColor} ${messageStr}`,
        data ? JSON.stringify(data, null, 2) : ""
    );

    // Write to JSON file
    writeToJsonLog(category, entry);
}

/**
 * Write log entry to category-specific JSON file
 */
function writeToJsonLog(category: LogCategory, entry: LogEntry): void {
    const filename = `${category}.json`;
    const filepath = path.join(DEBUG_LOG_DIR, filename);

    try {
        let logs: LogEntry[] = [];

        // Read existing logs
        if (fs.existsSync(filepath)) {
            const stats = fs.statSync(filepath);

            // Rotate file if too large
            if (stats.size > MAX_LOG_FILE_SIZE) {
                const backupPath = filepath.replace(".json", `.backup_${Date.now()}.json`);
                fs.renameSync(filepath, backupPath);
                console.log(`[debug-logger] Rotated log file: ${filename} -> ${path.basename(backupPath)}`);
            } else {
                const content = fs.readFileSync(filepath, "utf-8");
                try {
                    logs = JSON.parse(content);
                    if (!Array.isArray(logs)) logs = [];
                } catch {
                    logs = [];
                }
            }
        }

        // Append new entry
        logs.push(entry);

        // Keep only last 1000 entries in memory (write all to disk)
        if (logs.length > 1000) {
            logs = logs.slice(-1000);
        }

        // Write to file
        fs.writeFileSync(filepath, JSON.stringify(logs, null, 2), "utf-8");
    } catch (e) {
        console.error(`[debug-logger] Failed to write to ${filename}:`, e);
    }
}

/**
 * Read logs from a specific category
 */
export function readDebugLogs(
    category: LogCategory,
    limit = 50
): LogEntry[] {
    const filename = `${category}.json`;
    const filepath = path.join(DEBUG_LOG_DIR, filename);

    try {
        if (!fs.existsSync(filepath)) return [];

        const content = fs.readFileSync(filepath, "utf-8");
        const logs = JSON.parse(content) as LogEntry[];

        if (!Array.isArray(logs)) return [];

        // Return last N entries
        return logs.slice(-limit);
    } catch (e) {
        console.error(`[debug-logger] Failed to read ${filename}:`, e);
        return [];
    }
}

/**
 * Get all debug logs organized by category
 */
export function getAllDebugLogs(limit = 50): Record<LogCategory, LogEntry[]> {
    const categories: LogCategory[] = [
        "ai_decision",
        "order_execution",
        "risk_engine",
        "error",
        "websocket_health",
        "data_source",
    ];

    const result: Record<string, LogEntry[]> = {};

    for (const category of categories) {
        result[category] = readDebugLogs(category, limit);
    }

    return result as Record<LogCategory, LogEntry[]>;
}

/**
 * Clear all debug logs
 */
export function clearDebugLogs(category?: LogCategory): void {
    if (category) {
        const filepath = path.join(DEBUG_LOG_DIR, `${category}.json`);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`[debug-logger] Cleared logs: ${category}`);
        }
    } else {
        // Clear all logs
        const files = fs.readdirSync(DEBUG_LOG_DIR);
        for (const file of files) {
            if (file.endsWith(".json")) {
                fs.unlinkSync(path.join(DEBUG_LOG_DIR, file));
            }
        }
        console.log(`[debug-logger] Cleared all debug logs`);
    }
}

/**
 * Get summary statistics from logs
 */
export function getLogStats(): {
    category: LogCategory;
    count: number;
    lastEntry: string | null;
    errorCount: number;
}[] {
    const categories: LogCategory[] = [
        "ai_decision",
        "order_execution",
        "risk_engine",
        "error",
        "websocket_health",
        "data_source",
    ];

    return categories.map((category) => {
        const logs = readDebugLogs(category, 1000);
        const errorCount = logs.filter((log) => log.level === "ERROR").length;
        const lastEntry = logs.length > 0 ? logs[logs.length - 1]?.timestamp || null : null;

        return {
            category,
            count: logs.length,
            lastEntry,
            errorCount,
        };
    });
}
