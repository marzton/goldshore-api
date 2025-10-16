export interface Env {
  KV_CACHE?: KVNamespace;
  DB?: D1Database;
  R2?: R2Bucket;
  JOBS?: Queue;

  ENV?: string;
  CORS_ALLOWED_ORIGINS?: string;
  QUOTES_MAX_AGE?: string;
  NEWS_MAX_AGE?: string;
  FEATURE_NEWS?: string;
  FEATURE_REPORTS?: string;
  FEATURE_BACKTESTS?: string;

  ALPACA_KEY?: string;
  ALPACA_SECRET?: string;
  ALPACA_BASE_URL?: string;
  POLYGON_KEY?: string;
  OPENAI_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
  TRADE_WEBHOOK_TOKEN?: string;
}
