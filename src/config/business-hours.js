/**
 * ZOLVEX CRM — Central Business Hours Configuration
 * Single source of truth consumed by: Booking, Calendar, Dispatch, Availability Engine.
 *
 * To override, set environment variables or update values here.
 * Never hardcode 8 / 20 anywhere else in the codebase.
 */
export const BUSINESS_HOURS = {
    /** First hour of the working day (inclusive, 24h) */
    START_HOUR: parseInt(process.env.BUSINESS_HOURS_START || '8', 10),
    /** Last hour of the working day (inclusive, 24h) */
    END_HOUR: parseInt(process.env.BUSINESS_HOURS_END || '20', 10),
    /** Standard job slot duration in minutes */
    SLOT_DURATION_MINUTES: parseInt(process.env.BUSINESS_SLOT_MINUTES || '60', 10),
    /** Working days as ISO weekday numbers: 1=Mon … 7=Sun */
    WORKING_DAYS: (process.env.BUSINESS_DAYS || '1,2,3,4,5,6').split(',').map(Number),
    /** IANA timezone string for display purposes */
    TIMEZONE: process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata',
};
/** Returns true if the given Date falls within business hours (UTC-naive — caller must pass local time). */
export function isWithinBusinessHours(date) {
    const getIntInTZ = (d, part) => {
        return parseInt(new Intl.DateTimeFormat('en-US', {
            [part]: 'numeric',
            hourCycle: part === 'hour' ? 'h23' : undefined,
            timeZone: BUSINESS_HOURS.TIMEZONE
        }).format(d), 10);
    };
    const h = getIntInTZ(date, 'hour');
    // Intl weekday parsing is tricky; an alternative is to parse it to a localized date object.
    // But for now let's just use the robust hour check.
    const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: BUSINESS_HOURS.TIMEZONE });
    const tzDateStr = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_HOURS.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    const tzDate = new Date(tzDateStr);
    const dayOfWeek = tzDate.getDay() === 0 ? 7 : tzDate.getDay(); // Convert JS Sunday=0 to ISO Sunday=7
    return (BUSINESS_HOURS.WORKING_DAYS.includes(dayOfWeek) &&
        h >= BUSINESS_HOURS.START_HOUR &&
        h < BUSINESS_HOURS.END_HOUR);
}
