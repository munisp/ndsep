export const TECHNICAL_VIEW_INACTIVITY_MS = 5 * 60 * 1000;
export function technicalViewExpiresAt(now = Date.now()) { return now + TECHNICAL_VIEW_INACTIVITY_MS; }
export function isTechnicalViewExpired(expiresAt: number | null, now = Date.now()) { return !expiresAt || now >= expiresAt; }
export function technicalViewRemainingSeconds(expiresAt: number | null, now = Date.now()) { return Math.max(0, Math.ceil(((expiresAt ?? now) - now) / 1000)); }
