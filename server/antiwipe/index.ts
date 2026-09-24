/**
 * Anti-wipe module family — barrel exports.
 * See docs/runbooks/antiwipe-protection.md for the threat model and ops guide.
 */
export * from "./vault";
export * from "./ledger";
export * from "./guards";
export * from "./backupGuard";
export { antiwipeRouter } from "./router";
export {
  startAntiwipeScheduler,
  stopAntiwipeScheduler,
  getAntiwipeSchedulerStatus,
} from "./scheduler";
