export interface CacheBinding {
  KV_CACHE: KVNamespace;
}

export interface DatabaseBinding {
  DB: D1Database;
}

export interface ObjectStoreBinding {
  R2: R2Bucket;
}

export interface QueueBinding {
  JOBS: Queue;
}

export interface RuntimeBindings extends CacheBinding, DatabaseBinding, ObjectStoreBinding, QueueBinding {}

  ENV?: string;
  CORS_ALLOWED_ORIGINS?: string;
  QUOTES_MAX_AGE?: string;
  NEWS_MAX_AGE?: string;
  FEATURE_NEWS?: string;
  FEATURE_REPORTS?: string;
  FEATURE_BACKTESTS?: string;
export interface CorsConfig {
  CORS_ALLOWED_ORIGINS?: string;
  QUOTES_MAX_AGE?: string;
  NEWS_MAX_AGE?: string;
}

export interface AccessConfig {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_BYPASS_EMAILS?: string;
}

export interface AlpacaConfig {
  ALPACA_KEY?: string;
  ALPACA_SECRET?: string;
  ALPACA_BASE_URL?: string;
}

export interface PolygonConfig {
  POLYGON_KEY?: string;
}

export interface YoutubeConfig {
  YOUTUBE_API_KEY?: string;
}

export interface GoogleConfig {
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
}

export interface OpenAIConfig {
  OPENAI_API_KEY?: string;
}

export interface ProviderConfig
  extends AlpacaConfig,
    PolygonConfig,
    YoutubeConfig,
    GoogleConfig,
    OpenAIConfig {}

export interface Env extends RuntimeBindings, CorsConfig, AccessConfig, ProviderConfig {}
