import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, doublePrecision, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

// AI Signal Tracking
export const signals = pgTable("signals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  strength: doublePrecision("strength").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  regime: varchar("regime", { length: 50 }),
  price: doublePrecision("price").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  meta: jsonb("meta"), // RSI, ADX, Volatility info
});

// Closed Trade Outcomes
export const trades = pgTable("trades", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price").notNull(),
  pnlUsd: doublePrecision("pnl_usd").notNull(),
  entryTime: timestamp("entry_time").notNull(),
  exitTime: timestamp("exit_time").defaultNow().notNull(),
  exitReason: varchar("exit_reason", { length: 50 }).notNull(),
  context: jsonb("context"), // Entry RSI, ADX, etc
});

// Daily PnL & Stats Persistence
export const dailyStats = pgTable("daily_stats", {
  date: varchar("date", { length: 10 }).primaryKey(), // YYYY-MM-DD
  totalPnlUsd: doublePrecision("total_pnl_usd").default(0).notNull(),
  tradeCount: integer("trade_count").default(0).notNull(),
  consecutiveLosses: integer("consecutive_losses").default(0).notNull(),
});

// Active Position Metadata (Survives Restarts)
export const activePositions = pgTable("active_positions", {
  symbol: varchar("symbol", { length: 20 }).notNull(),
  productId: integer("product_id").notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  entryTime: timestamp("entry_time").defaultNow().notNull(),
  highestPnl: doublePrecision("highest_pnl").default(0),
  hasPartialClose: boolean("has_partial_close").default(false),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.symbol, table.productId] }),
  };
});

import { primaryKey } from "drizzle-orm/pg-core";

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertSignalSchema = createInsertSchema(signals);
export const insertTradeSchema = createInsertSchema(trades);
export const insertDailyStatsSchema = createInsertSchema(dailyStats);
export const insertActivePositionSchema = createInsertSchema(activePositions);

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type DailyStats = typeof dailyStats.$inferSelect;
export type ActivePosition = typeof activePositions.$inferSelect;

