export interface Env {
  KV_CACHE: KVNamespace;
  DB: D1Database;
  R2: R2Bucket;
  JOBS: Queue;
  ASSETS?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };

  CORS_ALLOWED_ORIGINS?: string;
  QUOTES_MAX_AGE?: string;
  NEWS_MAX_AGE?: string;

  ALPACA_KEY?: string;
  ALPACA_SECRET?: string;
  POLYGON_KEY?: string;
  OPENAI_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
  AGENT_SYSTEM_PROMPT?: string;
}
