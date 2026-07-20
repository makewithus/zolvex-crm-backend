import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * PROVIDER_MODE controls which credentials are required at startup.
 *   'mock'       — MockProvider only. No real credentials required.
 *   'sandbox'    — Sprint 10.2: Sandbox/test credentials required.
 *   'maps'       — Sprint 10.3: Requires GOOGLE_MAPS_API_KEY.
 *   'production' — All credentials required. Fails fast if any are missing.
 *
 * Default: 'mock' (safe for development and testing)
 */
const PROVIDER_MODE = (process.env.PROVIDER_MODE ?? 'mock') as 'mock' | 'sandbox' | 'maps' | 'production';

const baseSchema = z.object({
  PORT:         z.string().default('5000'),
  DATABASE_URL: z.string(),
  JWT_SECRET:   z.string(),

  // JWT expiry — e.g. '1d', '8h', '30m'
  JWT_EXPIRES_IN: z.string().default('1d'),

  // CORS — required in all modes so the server knows which origin to allow.
  // In development: http://localhost:5173 (Vite default).
  // In production: https://yourdomain.com
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // Invoice generation mode:
  //   AUTO   = Invoice auto-created on Job completion (recommended)
  //   MANUAL = Staff must trigger manually
  INVOICE_GENERATION_MODE: z.enum(['AUTO', 'MANUAL']).default('AUTO'),

  // Worker configuration (optional with defaults)
  NOTIFICATION_WORKER_INTERVAL_MS:    z.string().default('10000'),
  NOTIFICATION_WORKER_BATCH_SIZE:     z.string().default('20'),
  NOTIFICATION_PROVIDER_TIMEOUT_MS:   z.string().default('10000'),
  PROVIDER_MODE:                      z.enum(['mock', 'sandbox', 'maps', 'production']).default('mock'),

  // ── Feature Flags ────────────────────────────────────────────────────────
  // Enable/disable each notification channel independently.
  // Deploy the code first (flags=false), verify, then flip to true.
  // This avoids coupling a code deployment to a feature activation.
  SMTP_ENABLED:             z.enum(['true', 'false']).default('false'),
  WHATSAPP_ENABLED:         z.enum(['true', 'false']).default('false'),
  R2_INVOICE_PDF_ENABLED:   z.enum(['true', 'false']).default('false'),
  CHECKLIST_ENABLED:        z.enum(['true', 'false']).default('true'),
  WEBSITE_WEBHOOK_ENABLED:  z.enum(['true', 'false']).default('false'),
  WEBHOOK_SYSTEM_USER_ID:   z.string().optional(),
  WEBSITE_WEBHOOK_SECRET:   z.string().optional(),
});

const sandboxSchema = baseSchema.extend({
  // Meta WhatsApp (required in sandbox + production)
  META_ACCESS_TOKEN:          z.string({ error: 'META_ACCESS_TOKEN is required for sandbox/production mode' }),
  META_PHONE_NUMBER_ID:       z.string({ error: 'META_PHONE_NUMBER_ID is required for sandbox/production mode' }),
  META_WHATSAPP_API_VERSION:  z.string().default('v18.0'),
  META_WHATSAPP_BASE_URL:     z.string().default('https://graph.facebook.com'),

  // Meta Webhook security (required in sandbox + production)
  // META_VERIFY_TOKEN: a random string you define — sent back by Meta to verify ownership
  // META_APP_SECRET:   from Meta App dashboard — used to verify webhook signature (HMAC-SHA256)
  META_VERIFY_TOKEN:          z.string({ error: 'META_VERIFY_TOKEN is required for sandbox/production mode' }),
  META_APP_SECRET:            z.string({ error: 'META_APP_SECRET is required for sandbox/production mode' }),

  // Email (required in sandbox + production)
  SMTP_HOST:           z.string({ error: 'SMTP_HOST is required for sandbox/production mode' }),
  SMTP_PORT:           z.string({ error: 'SMTP_PORT is required for sandbox/production mode' }),
  SMTP_USER:           z.string({ error: 'SMTP_USER is required for sandbox/production mode' }),
  SMTP_PASS:           z.string({ error: 'SMTP_PASS is required for sandbox/production mode' }),
  EMAIL_FROM_ADDRESS:  z.string().default('noreply@zolvex.in'),
});

const mapsSchema = baseSchema.extend({
  GOOGLE_MAPS_API_KEY: z.string({ error: 'GOOGLE_MAPS_API_KEY is required in maps mode' }),
});

const productionSchema = sandboxSchema.extend({
  // SMS (required in production only)
  SMS_PROVIDER:          z.enum(['TWILIO', 'TEXTLOCAL'] as const),
  TWILIO_ACCOUNT_SID:    z.string().optional(),
  TWILIO_AUTH_TOKEN:     z.string().optional(),
  TWILIO_FROM_NUMBER:    z.string().optional(),
  TEXTLOCAL_API_KEY:     z.string().optional(),

  // Google Maps (required in production only)
  GOOGLE_MAPS_API_KEY:   z.string({ error: 'GOOGLE_MAPS_API_KEY is required in production' }),

  // Cloudflare R2 object storage (required in production only)
  // R2 is S3-compatible — uses @aws-sdk/client-s3 with a custom endpoint.
  // R2_ENDPOINT format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  // R2_PUBLIC_URL:       your public bucket URL (e.g. https://media.zolvex.in)
  R2_ACCOUNT_ID:         z.string({ error: 'R2_ACCOUNT_ID is required in production' }),
  R2_ACCESS_KEY_ID:      z.string({ error: 'R2_ACCESS_KEY_ID is required in production' }),
  R2_SECRET_ACCESS_KEY:  z.string({ error: 'R2_SECRET_ACCESS_KEY is required in production' }),
  R2_BUCKET:             z.string({ error: 'R2_BUCKET is required in production' }),
  R2_ENDPOINT:           z.string({ error: 'R2_ENDPOINT is required in production' }),
  R2_PUBLIC_URL:         z.string({ error: 'R2_PUBLIC_URL is required in production' }),
});

// Select schema based on PROVIDER_MODE — fail fast if credentials are missing
const schemaByMode = {
  mock:       baseSchema,
  sandbox:    sandboxSchema,
  maps:       mapsSchema,
  production: productionSchema,
};

const parseResult = schemaByMode[PROVIDER_MODE].safeParse(process.env);

if (!parseResult.success) {
  console.error(`\n[ENV] ❌ STARTUP FAILED — Invalid environment for PROVIDER_MODE="${PROVIDER_MODE}":`);
  for (const err of parseResult.error.issues) {
    console.error(`  - ${err.path.join('.')}: ${err.message}`);
  }
  console.error('\nFix the above environment variables before starting the server.\n');
  process.exit(1);
}

export const env = parseResult.data;
export { PROVIDER_MODE };
