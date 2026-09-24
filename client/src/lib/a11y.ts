/**
 * Accessibility helpers (gap 10)
 *
 * WCAG 2.1 AA support utilities:
 *   - trapFocus: keyboard focus trap for modals/dialogs
 *   - SkipLink: "skip to main content" component (React.createElement so this
 *     stays a .ts module; render once near the app root)
 *   - announce / AriaLiveAnnouncer: polite & assertive aria-live region
 *     announcements for dynamic status changes
 */
import { createElement, type CSSProperties, type ReactElement } from "react";

// ─── Focus trap ─────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside `container` until the returned release function
 * is called. Tab/Shift+Tab cycle within the container; Escape (optional)
 * invokes `onEscape`.
 */
export function trapFocus(container: HTMLElement, onEscape?: () => void): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const focusables = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );

  // Move focus into the container on activation.
  const first = focusables()[0];
  (first ?? container).focus();

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    if (event.shiftKey && (index <= 0)) {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (!event.shiftKey && (index === -1 || index === items.length - 1)) {
      event.preventDefault();
      items[0].focus();
    }
  }

  container.addEventListener("keydown", onKeyDown);
  return () => {
    container.removeEventListener("keydown", onKeyDown);
    previouslyFocused?.focus?.();
  };
}

// ─── Skip link ──────────────────────────────────────────────────────────────

const skipLinkStyle: CSSProperties = {
  position: "absolute",
  left: "-9999px",
  top: "0",
  zIndex: 9999,
  padding: "8px 16px",
  background: "#1a3a5c",
  color: "#ffffff",
  borderRadius: "0 0 4px 0",
  fontWeight: 600,
  textDecoration: "none",
};

const skipLinkFocusStyle: CSSProperties = { left: "0" };

/**
 * "Skip to main content" link — first focusable element on the page, visible
 * on keyboard focus. Target element defaults to `#main-content`; ensure the
 * main landmark carries that id and `tabIndex={-1}`.
 */
export function SkipLink(props: { targetId?: string; label?: string } = {}): ReactElement {
  const targetId = props.targetId ?? "main-content";
  const label = props.label ?? "Skip to main content";
  return createElement("a", {
    href: `#${targetId}`,
    className: "ndsep-skip-link",
    style: skipLinkStyle,
    onFocus: (e: { currentTarget: HTMLElement }) => Object.assign(e.currentTarget.style, skipLinkFocusStyle),
    onBlur: (e: { currentTarget: HTMLElement }) => Object.assign(e.currentTarget.style, skipLinkStyle),
    onClick: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      const target = document.getElementById(targetId);
      if (target) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus();
        target.scrollIntoView({ block: "start" });
      }
    },
  }, label);
}

// ─── aria-live announcer ────────────────────────────────────────────────────

let liveRegion: HTMLElement | null = null;

function ensureLiveRegion(politeness: "polite" | "assertive"): HTMLElement {
  const id = `ndsep-aria-live-${politeness}`;
  let region = document.getElementById(id);
  if (!region) {
    region = document.createElement("div");
    region.id = id;
    region.setAttribute("role", politeness === "assertive" ? "alert" : "status");
    region.setAttribute("aria-live", politeness);
    region.setAttribute("aria-atomic", "true");
    Object.assign(region.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0 0 0 0)",
      whiteSpace: "nowrap",
      border: "0",
    } satisfies CSSProperties);
    document.body.appendChild(region);
  }
  liveRegion = region;
  return region;
}

/**
 * Announce a message to screen readers via a visually-hidden aria-live region.
 * Use "polite" (default) for status updates, "assertive" for errors/alerts.
 * The region is cleared first so identical consecutive messages re-announce.
 */
export function announce(message: string, politeness: "polite" | "assertive" = "polite"): void {
  if (typeof document === "undefined") return;
  const region = ensureLiveRegion(politeness);
  region.textContent = "";
  // Defer so assistive tech registers the DOM change even for repeats.
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}
