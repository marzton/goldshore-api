import type { Env } from "../../types";

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChoice {
  message?: { content?: string };
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
}

const DEFAULT_MODEL = "gpt-4o-mini";

export async function callChatCompletion(env: Env, messages: ChatCompletionMessage[]): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const model = env.AI_MODEL ?? DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error: ${response.status} ${text}`);
  }

  const body = (await response.json()) as OpenAIResponse;
  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("No content returned from model");
  }

  return content.trim();
}
