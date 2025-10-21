import type { Env } from "../../types";

const MAX_LOG_LENGTH = 4_096;

export interface SystemLogEntry {
  type: string;
  status: string;
  [key: string]: unknown;
}

export async function writeSystemLog(env: Env, entry: SystemLogEntry): Promise<void> {
  if (!env.SYSTEM_LOGS) {
    return;
  }

  const key = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
  const payload = JSON.stringify(truncateLargeFields(entry));

  try {
    await env.SYSTEM_LOGS.put(key, payload, {
      metadata: {
        type: entry.type,
        status: entry.status
      }
    });
  } catch (_err) {
    // Swallow logging errors to avoid impacting caller
  }
}

function truncateLargeFields(entry: SystemLogEntry): SystemLogEntry {
  const clone: SystemLogEntry = { ...entry };

  for (const [key, value] of Object.entries(clone)) {
    if (typeof value === "string" && value.length > MAX_LOG_LENGTH) {
      clone[key] = `${value.slice(0, MAX_LOG_LENGTH)}…`;
    }
  }

  return clone;
}
