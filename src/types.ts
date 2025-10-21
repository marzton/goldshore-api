import type { Fetcher } from "@cloudflare/workers-types";

export interface Env {
  /**
   * Comma-separated list of allowed CORS origins. Supports exact origins and globs (e.g. https://*.goldshore.org).
   */
  CORS_ORIGINS?: string;
  /**
   * Optional override for Access-Control-Allow-Headers.
   */
  CORS_ALLOW_HEADERS?: string;
  /**
   * Optional override for Access-Control-Max-Age.
   */
  CORS_MAX_AGE?: string;
  /**
   * Whether to omit Access-Control-Allow-Credentials header (set to "false" to disable credentials).
   */
  CORS_ALLOW_CREDENTIALS?: string;

  /**
   * Cloudflare Access issuer URL for Gold Shore Labs (used to validate Cf-Access-Jwt-Assertion tokens).
   */
  ACCESS_ISSUER?: string;
  /**
   * JWKS endpoint corresponding to the issuer.
   */
  ACCESS_JWKS_URL?: string;

  /**
   * Legacy bindings retained for backwards compatibility. All are optional to keep the worker deployable
   * even when supporting services are not provisioned in a given environment.
   */
  KV_CACHE?: KVNamespace;
  DB?: D1Database;
  R2?: R2Bucket;
  JOBS?: Queue;
  SYSTEM_LOGS?: KVNamespace;
  APPLIED_JOBS?: KVNamespace;
  AGENT_STATE?: KVNamespace;

  QUOTES_MAX_AGE?: string;
  NEWS_MAX_AGE?: string;

  ALPACA_KEY?: string;
  ALPACA_SECRET?: string;
  POLYGON_KEY?: string;
  OPENAI_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;

  SERVICE_NAME?: string;
  SERVICE_VERSION?: string;
  AI_MODEL?: string;
  PUBLIC_ADMIN?: string;

  AGENT_SYSTEM_PROMPT?: string;
  AGENT_PROMPT_KV?: KVNamespace;
  ASSETS?: Fetcher;
}
