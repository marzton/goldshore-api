import type { Env } from "../types";

const FALLBACK_PROMPT = "Gold Shore Labs — system prompt not found.";

async function loadFromKv(bindings: Env): Promise<string | undefined> {
  if (!bindings.AGENT_PROMPT_KV) {
    return undefined;
  }

  try {
    return await bindings.AGENT_PROMPT_KV.get("prompt.md") ?? undefined;
  } catch (_err) {
    return undefined;
  }
}

async function loadFromAssets(bindings: Env): Promise<string | undefined> {
  if (!bindings.ASSETS) {
    return undefined;
  }

  try {
    const response = await bindings.ASSETS.fetch(new URL("/agent/prompt.md", "http://assets"));
    if (!response || !response.ok) {
      return undefined;
    }
    return await response.text();
  } catch (_err) {
    return undefined;
  }
}

export async function loadSystemPrompt(_ctx: ExecutionContext, bindings: Env): Promise<string> {
  const envPrompt = bindings.AGENT_SYSTEM_PROMPT?.trim();
  if (envPrompt) {
    return envPrompt;
  }

  const kvPrompt = await loadFromKv(bindings);
  if (kvPrompt) {
    return kvPrompt;
  }

  const assetPrompt = await loadFromAssets(bindings);
  if (assetPrompt) {
    return assetPrompt;
  }

  return FALLBACK_PROMPT;
}
