import { z } from "zod";

/**
 * 🚀 High-Performance In-Memory Schema
 * Database dependencies have been removed as per user request.
 * Using pure TypeScript interfaces for zero-latency in-memory state.
 */

export interface User {
  id: string;
  username: string;
  password?: string;
}

export interface Signal {
  id: number;
  symbol: string;
  direction: string;
  strength: number;
  confidence: number;
  regime?: string;
  price: number;
  timestamp: Date;
  meta?: any;
}

export interface Trade {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  entryTime: Date;
  exitTime: Date;
  exitReason: string;
  context?: any;
}

export interface DailyStats {
  date: string;
  totalPnlUsd: number;
  tradeCount: number;
  consecutiveLosses: number;
}

export interface ActivePosition {
  symbol: string;
  productId: number;
  side: string;
  entryPrice: number;
  entryTime: Date;
  highestPnl?: number;
  hasPartialClose?: boolean;
}

// Zod schemas for validation (if needed by frontend/API)
export const insertUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const insertSignalSchema = z.object({
  symbol: z.string(),
  direction: z.string(),
  strength: z.number(),
  confidence: z.number(),
  regime: z.string().optional(),
  price: z.number(),
  meta: z.any().optional(),
});

export const insertTradeSchema = z.object({
  symbol: z.string(),
  side: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  pnlUsd: z.number(),
  entryTime: z.date(),
  exitTime: z.date(),
  exitReason: z.string(),
  context: z.any().optional(),
});

export const insertDailyStatsSchema = z.object({
  date: z.string(),
  totalPnlUsd: z.number(),
  tradeCount: z.number(),
  consecutiveLosses: z.number(),
});

export const insertActivePositionSchema = z.object({
  symbol: z.string(),
  productId: z.number(),
  side: z.string(),
  entryPrice: z.number(),
  entryTime: z.date(),
  highestPnl: z.number().optional(),
  hasPartialClose: z.boolean().optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;

