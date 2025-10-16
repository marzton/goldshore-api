import type { AlpacaConfig } from "../../types";

export async function alpaca(env: AlpacaConfig, path: string, init: RequestInit = {}) {
  if (!env.ALPACA_KEY || !env.ALPACA_SECRET) throw new Error("ALPACA credentials missing");
  const base = env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets/v2";
  const url = `${base}${path}`;
  const headers = {
    "APCA-API-KEY-ID": env.ALPACA_KEY,
    "APCA-API-SECRET-KEY": env.ALPACA_SECRET,
    "Content-Type": "application/json",
    ...(init.headers || {})
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca ${res.status}: ${text}`);
  }
  return res.json();
}
