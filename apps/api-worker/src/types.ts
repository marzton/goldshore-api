import { z } from 'zod';
import { envSchema } from '@goldshore/env';

// We can still extend the base schema if there are worker-specific vars
const apiWorkerSchema = envSchema.extend({
  // worker-specific vars here
});

export type Env = z.infer<typeof apiWorkerSchema>;
