import { z } from 'zod';
import { envSchema } from '@goldshore/env';

const gatewaySchema = envSchema.extend({
  // gateway-specific vars here
});

export type Env = z.infer<typeof gatewaySchema>;
