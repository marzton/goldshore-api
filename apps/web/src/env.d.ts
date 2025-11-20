import { z } from 'zod';
import { envSchema } from '@goldshore/env';

const webSchema = envSchema.extend({
  // web-specific vars here
});

type Env = z.infer<typeof webSchema>;

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
