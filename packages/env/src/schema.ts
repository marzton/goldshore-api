import { z } from 'zod';

/**
 * =================================================================================
 * UNIVERSAL
 * Core Cloudflare account, project, and environment identifiers.
 * Must be present in every Worker, Pages project, and Terraform configuration.
 * =================================================================================
 */
const UniversalEnvSchema = z.object({
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1, 'Cloudflare Account ID is required'),
  CLOUDFLARE_API_TOKEN: z.string().min(1, 'Cloudflare API Token is required'),
  CLOUDFLARE_ZONE_ID: z.string().min(1, 'Cloudflare Zone ID is required'),
  CLOUDFLARE_ENV: z.enum(['dev', 'staging', 'prod']),
  CLOUDFLARE_PROJECT: z.string().min(1, 'Cloudflare project name is required'),
  CLOUDFLARE_BASE_DOMAIN: z.string().min(1),
  CLOUDFLARE_PUBLIC_URL: z.string().url('Must be a valid URL'),
});

/**
 * =================================================================================
 * ACCESS / AUTH
 * Variables for Cloudflare Access, JWT validation, and identity services.
 * =================================================================================
 */
const AccessAuthEnvSchema = z.object({
  CF_ACCESS_TEAM_DOMAIN: z.string().min(1),
  CF_ACCESS_AUD: z.string(),
  CF_ACCESS_JWKS_URL: z.string().url(),
  CF_ACCESS_POLICY_ID: z.string().optional(),
});

/**
 * =================================================================================
 * INTERNAL SERVICES
 * Endpoints and credentials for internal service-to-service communication.
 * =================================================================================
 */
const InternalServicesEnvSchema = z.object({
  INTERNAL_API_BASE_URL: z.string().url(),
  INTERNAL_API_KEY: z.string(),
  INTERNAL_GW_URL: z.string().url(),
  INTERNAL_GW_TOKEN: z.string(),
});

/**
 * =================================================================================
 * STORAGE / INFRA
 * Constant IDs for Cloudflare storage and infrastructure resources.
 * These should not change between deployments.
 * =================================================================================
 */
const StorageInfraEnvSchema = z.object({
  KV_NAMESPACE_ID: z.string(),
  R2_BUCKET_ID: z.string(),
  QUEUE_NAMESPACE_ID: z.string(),
  DURABLE_OBJECTS_NAMESPACE_ID: z.string(),
});

/**
 * =================================================================================
 * SECURITY
 * Secrets for JWT, sessions, and cryptographic functions.
 * Must be identical across services that share authentication state.
 * =================================================================================
 */
const SecurityEnvSchema = z.object({
  JWT_SECRET: z.string(),
  SESSION_SECRET: z.string(),
  ENCRYPTION_KEY: z.string(),
  SIGNING_KEY: z.string(),
});

/**
 * =================================================================================
 * FRONTEND RUNTIME
 * Build-time and runtime variables for frontend applications (Vite/Astro).
 * =================================================================================
 */
const FrontendRuntimeEnvSchema = z.object({
  VITE_PUBLIC_BASE_URL: z.string().url(),
  VITE_API_URL: z.string().url(),
  VITE_GATEWAY_URL: z.string().url(),
  VITE_APP_ENV: z.enum(['dev', 'staging', 'prod', 'local']),
  VITE_ASSETS_BASE: z.string(),
});

/**
 * =================================================================================
 * LOGGING
 * Configuration for observability, tracing, and AI debugging.
 * =================================================================================
 */
const LoggingEnvSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  LOG_SERVICE_NAME: z.string(),
  AI_LOG_ENDPOINT: z.string().url().optional(),
  AI_AGENT_NAME: z.string().optional(),
});

/**
 * =================================================================================
 * AI GATEWAY
 * Configuration for the AI Gateway, model routing, and RAG.
 * =================================================================================
 */
const AIGatewayEnvSchema = z.object({
  GSL_AI_GATEWAY_URL: z.string().url(),
  GSL_AI_GATEWAY_KEY: z.string(),
  GSL_DEFAULT_MODEL: z.string(),
  GSL_EMBEDDING_MODEL: z.string(),
  GSL_RAG_INDEX: z.string(),
});

/**
 * =================================================================================
 * TERRAFORM STATE
 * Variables for managing Terraform state in a remote backend.
 * =================================================================================
 */
const TerraformStateEnvSchema = z.object({
  TF_STATE_BUCKET: z.string(),
  TF_STATE_KEY: z.string(),
  TF_STATE_REGION: z.string(),
  TF_VAR_environment: z.enum(['dev', 'staging', 'prod']),
  TF_VAR_project: z.string(),
});

/**
 * =================================================================================
 * ROUTING
 * Configuration for idempotent routing in Cloudflare Pages and Workers.
 * =================================================================================
 */
const RoutingEnvSchema = z.object({
  PRIMARY_ROUTE: z.string(),
  FALLBACK_ROUTE: z.string(),
  ERROR_PAGE_PATH: z.string(),
  BUILD_OUTPUT_DIR: z.string(),
  ASSET_MANIFEST_PATH: z.string(),
});

/**
 * =================================================================================
 * PROJECT-SPECIFIC
 * Mandatory variables for individual Gold Shore applications.
 * =================================================================================
 */
const ProjectSpecificEnvSchema = z.object({
  // goldshore-api
  API_VERSION: z.string().optional(),
  API_PUBLIC_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),

  // goldshore-admin
  ADMIN_PUBLIC_URL: z.string().url().optional(),
  ADMIN_AUTH_REQUIRED: z.coerce.boolean().optional(),

  // goldshore-web
  WEB_PUBLIC_URL: z.string().url().optional(),
  WEB_THEME_MODE: z.enum(['light', 'dark', 'system']).optional(),
  WEB_CDN_BASE: z.string().url().optional(),

  // goldshore-gateway
  GATEWAY_PUBLIC_URL: z.string().url().optional(),
  GATEWAY_ROUTING_TABLE: z.string().optional(),
});

/**
 * =================================================================================
 * CANONICAL MASTER SCHEMA
 * The final, unified schema combining all required environment variables.
 * Use this to validate the environment for any Gold Shore application.
 * =================================================================================
 */
export const CanonicalEnvSchema = UniversalEnvSchema
  .and(AccessAuthEnvSchema)
  .and(InternalServicesEnvSchema)
  .and(StorageInfraEnvSchema)
  .and(SecurityEnvSchema)
  .and(FrontendRuntimeEnvSchema)
  .and(LoggingEnvSchema)
  .and(AIGatewayEnvSchema)
  .and(TerraformStateEnvSchema)
  .and(RoutingEnvSchema)
  .and(ProjectSpecificEnvSchema);

/**
 * =================================================================================
 * TYPE INFERENCE
 * Export a TypeScript type for type-safe access to environment variables.
 * =================================================================================
 */
export type CanonicalEnv = z.infer<typeof CanonicalEnvSchema>;
