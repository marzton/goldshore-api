import { z } from 'zod';
import { envSchema } from '@goldshore/env';

const adminSchema = envSchema.extend({
  // admin-specific vars here
});

type Env = z.infer<typeof adminSchema>;

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    CUSTOMER_WORKFLOW: Workflow;
    DB: D1Database;
  }
}
