import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../types";

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

export const getDb = (env: Env): D1Database => {
  if (!env.DB) {
    throw new DatabaseError("DB binding is not configured on this environment");
  }
  return env.DB;
};

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    limit: number;
    offset: number;
  };
}

export const parseLimit = (value: string | null, fallback = 25, max = 100): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
};

export const parseOffset = (value: string | null, fallback = 0): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};
