export const TECHNICAL_VIEW_INACTIVITY_MS = 5 * 60 * 1000;
export function technicalViewExpiresAt(now = Date.now()) { return now + TECHNICAL_VIEW_INACTIVITY_MS; }
export function isTechnicalViewExpired(expiresAt: number | null, now = Date.now()) { return !expiresAt || now >= expiresAt; }
export function technicalViewRemainingSeconds(expiresAt: number | null, now = Date.now()) { return Math.max(0, Math.ceil(((expiresAt ?? now) - now) / 1000)); }
export function formatTechnicalViewCountdown(seconds: number) { return `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0")}:${(Math.max(0, seconds) % 60).toString().padStart(2, "0")}`; }
export function isTechnicalViewLockWarning(seconds: number) { return seconds > 0 && seconds <= 60; }
