import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

// Well-known setting keys — use these constants everywhere, never raw strings
export const SETTING_KEYS = {
  COMPANY_REGISTERED_STATE: 'company_registered_state',
  COMPANY_NAME:             'company_name',
  COMPANY_GSTIN:            'company_gstin',
  COMPANY_ADDRESS:          'company_address',
  COMPANY_EMAIL:            'company_email',
  COMPANY_PHONE:            'company_phone',
  // New settings (Sprint 12 batch)
  COMPANY_SUPPORT_PHONE:    'company_support_phone',
  COMPANY_SUPPORT_EMAIL:    'company_support_email',
  INVOICE_FOOTER_NOTE:      'invoice_footer_note',
  BOOKING_ADVANCE_DAYS:     'booking_advance_days',  // How many days ahead bookings can be scheduled
} as const;

// Default values used when the DB row doesn't exist yet (first boot)
const DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.COMPANY_REGISTERED_STATE]: process.env.COMPANY_STATE || 'Maharashtra',
  [SETTING_KEYS.COMPANY_NAME]:             'Zolvex Services Pvt. Ltd.',
  [SETTING_KEYS.COMPANY_GSTIN]:            '',
  [SETTING_KEYS.COMPANY_ADDRESS]:          '',
  [SETTING_KEYS.COMPANY_EMAIL]:            '',
  [SETTING_KEYS.COMPANY_PHONE]:            '',
  [SETTING_KEYS.COMPANY_SUPPORT_PHONE]:    '',
  [SETTING_KEYS.COMPANY_SUPPORT_EMAIL]:    'support@zolvex.in',
  [SETTING_KEYS.INVOICE_FOOTER_NOTE]:      'Thank you for choosing Zolvex Services.',
  [SETTING_KEYS.BOOKING_ADVANCE_DAYS]:     '30',
};

/**
 * Read a single setting by key.
 * Returns the DB value if it exists, otherwise falls back to the hardcoded default.
 */
export const getSetting = async (key: string): Promise<string> => {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? '';
};

/**
 * Upsert a single setting.  Only Super Admin should call this via the route.
 */
export const upsertSetting = async (
  key: string,
  value: string,
  label: string | undefined,
  updatedBy: string
): Promise<void> => {
  if (!Object.values(SETTING_KEYS).includes(key as any)) {
    throw new AppError(`Unknown setting key: ${key}`, 400);
  }
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value, label, updated_by: updatedBy, updated_at: new Date() },
    create: { key, value, label, updated_by: updatedBy },
  });
};

/**
 * Bulk read: returns an object of all known settings with their current values.
 */
export const getAllSettings = async (): Promise<Record<string, string>> => {
  const rows = await prisma.systemSetting.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
};

// ---------------------------------------------------------------------------
// In-process cache for the registered state — avoids a DB round-trip on every
// single booking creation while still honouring live updates.
// ---------------------------------------------------------------------------
let _cachedState: string | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // re-read from DB at most every 60 s

export const getCompanyRegisteredState = async (): Promise<string> => {
  const now = Date.now();
  if (_cachedState && now < _cacheExpiry) return _cachedState;

  const state = await getSetting(SETTING_KEYS.COMPANY_REGISTERED_STATE);
  _cachedState = state;
  _cacheExpiry = now + CACHE_TTL_MS;
  return state;
};

/**
 * Call this after a successful upsert of COMPANY_REGISTERED_STATE
 * so the cache reflects the new value immediately.
 */
export const invalidateCompanyStateCache = (): void => {
  _cachedState = null;
  _cacheExpiry = 0;
};
