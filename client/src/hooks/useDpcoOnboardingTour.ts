/**
 * useDpcoOnboardingTour.ts
 * Runs a driver.js guided tour for first-time DPCO portal visitors.
 * The tour is shown once per browser session (localStorage flag).
 */

import { useEffect } from "react";

const TOUR_KEY = "ndsep_dpco_tour_seen_v1";

export function useDpcoOnboardingTour(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (localStorage.getItem(TOUR_KEY)) return;

    // Dynamically import driver.js to avoid SSR issues
    import("driver.js").then(({ driver }) => {
      import("driver.js/dist/driver.css");

      const driverObj = driver({
        showProgress: true,
        animate: true,
        overlayColor: "rgba(0,0,0,0.65)",
        smoothScroll: true,
        allowClose: true,
        onDestroyed: () => {
          localStorage.setItem(TOUR_KEY, "1");
        },
        steps: [
          {
            element: "[data-tour='dpco-header']",
            popover: {
              title: "Welcome to the DPCO Portal",
              description:
                "This is your National Data Sovereignty Enforcement Platform dashboard. " +
                "You are viewing the <strong>DataGuard Ltd</strong> demo account — all data is sample data.",
              side: "bottom",
              align: "start",
            },
          },
          {
            element: "[data-tour='dpco-kpi-cards']",
            popover: {
              title: "Live KPI Summary",
              description:
                "Your key performance indicators: active clients, open audits, invoices due, and compliance score — all updated in real time from the NDPC registry.",
              side: "bottom",
              align: "center",
            },
          },
          {
            element: "[data-tour='dpco-compliance-ring']",
            popover: {
              title: "Compliance Health Score",
              description:
                "Tap the ring to see a breakdown of how your score is calculated — client count, training sessions, pending audits, and overdue invoices all contribute.",
              side: "right",
              align: "center",
            },
          },
          {
            element: "[data-tour='dpco-quick-actions']",
            popover: {
              title: "Quick Actions",
              description:
                "Jump directly to your most-used workflows: create an invoice, start an audit, schedule training, or draft a policy — all in one click.",
              side: "top",
              align: "center",
            },
          },
          {
            element: "[data-tour='dpco-nav-billing']",
            popover: {
              title: "Billing & Earnings",
              description:
                "Manage your invoices, record payments, download PDFs, and pay online via Stripe. Your 10% platform fee is automatically split on every payment.",
              side: "right",
              align: "center",
            },
          },
          {
            element: "[data-tour='dpco-nav-audit']",
            popover: {
              title: "Audit Workspace",
              description:
                "Track all your client audit engagements, upload evidence, generate Compliance Audit Reports (CARs), and submit findings to NDPC.",
              side: "right",
              align: "center",
            },
          },
          {
            element: "[data-tour='dpco-nav-subscription']",
            popover: {
              title: "Subscription Tier",
              description:
                "Upgrade from Starter (12% fee) to Professional (10%) or Enterprise (8%) to reduce your platform fee as your client base grows.",
              side: "right",
              align: "center",
            },
          },
          {
            popover: {
              title: "You're all set!",
              description:
                "Explore the portal freely. This is demo mode — no real data will be affected. " +
                "Click <strong>Reset Demo Data</strong> in the banner at any time to restore the sample dataset.",
            },
          },
        ],
      });

      // Small delay so the DOM is fully rendered before the tour starts
      setTimeout(() => driverObj.drive(), 800);
    });
  }, [enabled]);
}
