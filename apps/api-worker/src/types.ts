import { z } from 'zod';
import { envSchema } from '@goldshore/env';

  ACCESS_AUDIENCE?: string;
  ACCESS_ISSUER?: string;
  ACCESS_JWKS_URL?: string;

  CORS_ALLOWED_ORIGINS?: string;
  CORS_ORIGINS?: string;
  QUOTES_MAX_AGE?: string;
  NEWS_MAX_AGE?: string;

  ALPACA_KEY?: string;
  ALPACA_SECRET?: string;
  ENV?: string;
  FEATURE_NEWS?: string;
  FEATURE_REPORTS?: string;
  FEATURE_BACKTESTS?: string;

  ALPACA_BASE_URL?: string;
  POLYGON_KEY?: string;
  OPENAI_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
  TRADE_WEBHOOK_TOKEN?: string;
}
// We can still extend the base schema if there are worker-specific vars
const apiWorkerSchema = envSchema.extend({
  // worker-specific vars here
});

export type Env = z.infer<typeof apiWorkerSchema>;
