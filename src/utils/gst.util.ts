/**
 * GST Calculation Utility
 *
 * Source of truth: SystemSetting table (key = "company_registered_state").
 * Falls back to COMPANY_STATE env var → "Maharashtra" if not yet seeded.
 *
 * Indian GST Rules:
 *   Intra-state (company_state == customer_state) → CGST + SGST, IGST = 0
 *   Inter-state  (company_state != customer_state) → IGST only, CGST = SGST = 0
 */
import { getCompanyRegisteredState } from '../services/settings.service';

export interface GSTBreakdown {
  cgst_percent: number;
  cgst_amount: number;
  sgst_percent: number;
  sgst_amount: number;
  igst_percent: number;
  igst_amount: number;
  total_tax: number;
  is_intra_state: boolean;
}

/**
 * Compute state-aware GST.
 * @param baseAmount    The taxable base price.
 * @param gstRate       Combined GST rate (e.g. 18 for 18%).
 * @param customerState The state recorded on the customer's booking address.
 */
export const calculateGST = async (
  baseAmount: number,
  gstRate: number,
  customerState: string
): Promise<GSTBreakdown> => {
  // DB read (cached for up to 60 s — see settings.service.ts)
  const companyState = await getCompanyRegisteredState();

  const isIntraState =
    companyState.trim().toLowerCase() === customerState.trim().toLowerCase();

  if (isIntraState) {
    const halfRate   = gstRate / 2;
    const halfAmount = (baseAmount * halfRate) / 100;
    return {
      cgst_percent: halfRate,
      cgst_amount:  halfAmount,
      sgst_percent: halfRate,
      sgst_amount:  halfAmount,
      igst_percent: 0,
      igst_amount:  0,
      total_tax:    halfAmount * 2,
      is_intra_state: true,
    };
  } else {
    const igstAmount = (baseAmount * gstRate) / 100;
    return {
      cgst_percent: 0,
      cgst_amount:  0,
      sgst_percent: 0,
      sgst_amount:  0,
      igst_percent: gstRate,
      igst_amount:  igstAmount,
      total_tax:    igstAmount,
      is_intra_state: false,
    };
  }
};
