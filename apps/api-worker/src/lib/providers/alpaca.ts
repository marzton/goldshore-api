import type { Env } from "../../types";

export async function alpaca(env: Env, path: string, init: RequestInit = {}) {
  if (!env.ALPACA_KEY || !env.ALPACA_SECRET) {
    throw new Error("ALPACA credentials missing");
  }
  const base = "https://paper-api.alpaca.markets/v2";
  const url = `${base}${path}`;
  const headers = {
    "APCA-API-KEY-ID": env.ALPACA_KEY,
    "APCA-API-SECRET-KEY": env.ALPACA_SECRET,
    "Content-Type": "application/json",
    ...(init.headers || {})
  };
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Alpaca ${response.status}: ${text}`);
  }
  return response.json();
}
