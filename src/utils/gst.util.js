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
/**
 * Compute state-aware GST.
 * @param baseAmount    The taxable base price.
 * @param gstRate       Combined GST rate (e.g. 18 for 18%).
 * @param customerState The state recorded on the customer's booking address.
 */
export const calculateGST = (baseAmount, cgstRate, sgstRate, igstRate, customerState, companyState) => {
    const isIntraState = companyState.trim().toLowerCase() === customerState.trim().toLowerCase();
    if (isIntraState) {
        const cgstAmount = (baseAmount * cgstRate) / 100;
        const sgstAmount = (baseAmount * sgstRate) / 100;
        return {
            cgst_percent: cgstRate,
            cgst_amount: cgstAmount,
            sgst_percent: sgstRate,
            sgst_amount: sgstAmount,
            igst_percent: 0,
            igst_amount: 0,
            total_tax: cgstAmount + sgstAmount,
            is_intra_state: true,
        };
    }
    else {
        const igstAmount = (baseAmount * igstRate) / 100;
        return {
            cgst_percent: 0,
            cgst_amount: 0,
            sgst_percent: 0,
            sgst_amount: 0,
            igst_percent: igstRate,
            igst_amount: igstAmount,
            total_tax: igstAmount,
            is_intra_state: false,
        };
    }
};
