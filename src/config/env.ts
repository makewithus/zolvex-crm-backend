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

  // Worker configuration (optional with defaults)
  NOTIFICATION_WORKER_INTERVAL_MS:    z.string().default('10000'),
  NOTIFICATION_WORKER_BATCH_SIZE:     z.string().default('20'),
  NOTIFICATION_PROVIDER_TIMEOUT_MS:   z.string().default('10000'),
  PROVIDER_MODE:                      z.enum(['mock', 'sandbox', 'maps', 'production']).default('mock'),
});

const sandboxSchema = baseSchema.extend({
  // Meta WhatsApp (required in sandbox + production)
  META_ACCESS_TOKEN:          z.string({ error: 'META_ACCESS_TOKEN is required for sandbox/production mode' }),
  META_PHONE_NUMBER_ID:       z.string({ error: 'META_PHONE_NUMBER_ID is required for sandbox/production mode' }),
  META_WHATSAPP_API_VERSION:  z.string().default('v18.0'),
  META_WHATSAPP_BASE_URL:     z.string().default('https://graph.facebook.com'),

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
