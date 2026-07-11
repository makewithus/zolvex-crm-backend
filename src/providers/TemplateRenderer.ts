import { RenderedMessage } from './NotificationProvider.interface';

/**
 * TEMPLATE REGISTRY
 *
 * Owns ALL message strings for the system.
 * Automation (Phase 9) enqueues only template_code + payload + payload_version.
 * TemplateRenderer converts those into delivery-ready strings.
 *
 * NAMING CONVENTION:
 * Template codes match Meta's approved template names exactly.
 * Format: snake_case, versioned suffix when the template evolves.
 *   e.g. booking_reminder_24h_v1, payment_receipt_v1
 *
 * VERSION STRATEGY:
 * render() dispatches by payload_version so old queued messages
 * with "1.0" always render correctly even after templates evolve.
 */

type TemplatePayload = Record<string, any>;

interface TemplateDefinition {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'ALL';
  requiredFields: string[];
  render: (payload: TemplatePayload) => string;
  subject?: (payload: TemplatePayload) => string; // Email only
}

// ── v1.0 Template Definitions ───────────────────────────────────────────────

const TEMPLATES_V1: Record<string, TemplateDefinition> = {
  booking_reminder_24h_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['customer_name', 'service_name', 'scheduled_date'],
    render: (p) =>
      `Hello ${p.customer_name}! This is a reminder that your *${p.service_name}* service is scheduled for *${formatDate(p.scheduled_date)}*. Please ensure someone is available at the premises. For any changes, contact us immediately.`
  },

  invoice_overdue_reminder_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['customer_name', 'invoice_number', 'balance_due', 'due_date'],
    render: (p) =>
      `Dear ${p.customer_name}, your invoice *${p.invoice_number}* has a balance of *₹${formatAmount(p.balance_due)}* which was due on ${formatDate(p.due_date)}. Kindly clear the dues at your earliest convenience to avoid service interruptions.`
  },

  payment_receipt_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['customer_name', 'payment_number', 'amount', 'invoice_number'],
    render: (p) =>
      `Dear ${p.customer_name}, we have received your payment of *₹${formatAmount(p.amount)}* (Receipt: ${p.payment_number}) against invoice *${p.invoice_number}*. ${Number(p.balance_due) > 0 ? `Remaining balance: ₹${formatAmount(p.balance_due)}.` : 'Your account is fully settled.'} Thank you!`
  },

  job_assignment_alert_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['technician_name', 'job_id', 'customer_name', 'scheduled_start', 'address'],
    render: (p) =>
      `Hi ${p.technician_name}! You have been assigned a new job.\n\n*Job ID:* ${p.job_id}\n*Customer:* ${p.customer_name}\n*Scheduled:* ${formatDate(p.scheduled_start)}\n*Address:* ${p.address}\n\nPlease confirm acceptance. If you have any issues, contact your supervisor.`
  },

  job_acceptance_reminder_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['technician_name', 'job_id'],
    render: (p) =>
      `Hi ${p.technician_name}, this is a reminder that job *${p.job_id}* has been assigned to you and is awaiting your confirmation. Please respond immediately.`
  },

  job_escalation_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['manager_name', 'technician_name', 'job_id'],
    render: (p) =>
      `*Escalation Alert* — ${p.manager_name}, job *${p.job_id}* assigned to ${p.technician_name} has not been accepted within 1 hour. Immediate action required.`
  },

  lead_followup_reminder_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['staff_name', 'lead_phone'],
    render: (p) =>
      `Hi ${p.staff_name}, a lead (${maskPhone(p.lead_phone)}) assigned to you 24 hours ago is still in *New* status. Please follow up immediately.`
  },

  lead_manager_escalation_v1: {
    channel: 'WHATSAPP',
    requiredFields: ['manager_name', 'lead_phone', 'assigned_to'],
    render: (p) =>
      `*Lead Escalation* — ${p.manager_name}, a lead (${maskPhone(p.lead_phone)}) assigned to ${p.assigned_to} has not been followed up in 48 hours. Immediate review required.`
  },
};

// ── Template Code Alias Map (Phase 9 codes → versioned names) ───────────────
// This allows Phase 9 to use short codes while rendering uses versioned names.
const CODE_ALIAS: Record<string, string> = {
  'BOOKING_REMINDER_24H':       'booking_reminder_24h_v1',
  'INVOICE_OVERDUE_REMINDER':   'invoice_overdue_reminder_v1',
  'PAYMENT_RECEIPT':            'payment_receipt_v1',
  'JOB_ASSIGNMENT_ALERT':       'job_assignment_alert_v1',
  'JOB_ACCEPTANCE_REMINDER':    'job_acceptance_reminder_v1',
  'JOB_ESCALATION':             'job_escalation_v1',
  'LEAD_FOLLOWUP_REMINDER':     'lead_followup_reminder_v1',
  'LEAD_MANAGER_ESCALATION':    'lead_manager_escalation_v1',
};

// ── Version Dispatch ─────────────────────────────────────────────────────────
const VERSION_MAPS: Record<string, typeof TEMPLATES_V1> = {
  '1.0': TEMPLATES_V1,
  // '2.0': TEMPLATES_V2  ← add future versions here
};

// ── Public API ───────────────────────────────────────────────────────────────

export class TemplateRenderer {
  /**
   * Renders a notification queue entry into a delivery-ready RenderedMessage.
   * Throws if template_code is unknown or required fields are missing.
   */
  render(
    template_code: string,
    payload: TemplatePayload,
    payload_version: string,
    recipient_id: string
  ): RenderedMessage {
    const version_map = VERSION_MAPS[payload_version];
    if (!version_map) {
      throw new Error(`TemplateRenderer: unknown payload_version "${payload_version}"`);
    }

    // Resolve alias (e.g. BOOKING_REMINDER_24H → booking_reminder_24h_v1)
    const resolved_code = CODE_ALIAS[template_code] ?? template_code;
    const def = version_map[resolved_code];

    if (!def) {
      throw new Error(`TemplateRenderer: unknown template_code "${template_code}" (resolved: "${resolved_code}")`);
    }

    // Validate required fields
    const missing = def.requiredFields.filter(f => payload[f] === undefined || payload[f] === null);
    if (missing.length > 0) {
      throw new Error(`TemplateRenderer: template "${resolved_code}" missing fields: ${missing.join(', ')}`);
    }

    return {
      to: recipient_id,
      body: def.render(payload),
      subject: def.subject ? def.subject(payload) : undefined,
      template_code: resolved_code,
      payload_version
    };
  }

  /** Returns the canonical (versioned) template name for a given code. */
  resolveCode(template_code: string): string {
    return CODE_ALIAS[template_code] ?? template_code;
  }

  /** Lists all registered template codes for the given version. */
  listTemplates(payload_version = '1.0'): string[] {
    return Object.keys(VERSION_MAPS[payload_version] ?? {});
  }
}

export const templateRenderer = new TemplateRenderer();

// ── Formatting Helpers ───────────────────────────────────────────────────────

function formatDate(value: any): string {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function formatAmount(value: any): string {
  return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return '****';
  return phone.slice(0, 3) + '****' + phone.slice(-3);
}
