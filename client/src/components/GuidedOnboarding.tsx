/**
 * NDSEP Guided Onboarding Component
 * Provides step-by-step interactive tour for first-time users.
 * Uses a lightweight overlay approach (no external dependencies).
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface OnboardingStep {
  target: string; // CSS selector or data attribute
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    target: '[aria-label="Main navigation"]',
    title: "Navigation",
    description: "Use the sidebar to navigate between platform modules. Sections can be collapsed by clicking their headers.",
    position: "right",
  },
  {
    target: '[data-tour="dpco-nav-billing"]',
    title: "DPCO Billing",
    description: "Manage subscription plans, invoices, and payment methods for your DPCO organization.",
    position: "right",
  },
  {
    target: '[aria-label="Notifications"]',
    title: "Notifications",
    description: "View platform alerts, compliance deadlines, and enforcement updates. Real-time updates appear here.",
    position: "bottom",
  },
  {
    target: '[aria-label="Global search"]',
    title: "Global Search",
    description: "Press Ctrl+K to quickly search across organizations, audits, cases, and settings.",
    position: "bottom",
  },
];

const ONBOARDING_KEY = "ndsep_onboarding_completed";

export function GuidedOnboarding() {
  const [currentStep, setCurrentStep] = useState(-1);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!completed) {
      // Auto-start after 2 seconds for first-time users
      const timer = setTimeout(() => setIsActive(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (isActive && currentStep === -1) {
      setCurrentStep(0);
    }
  }, [isActive, currentStep]);

  const handleNext = useCallback(() => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  }, [currentStep]);

  const handleComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setIsActive(false);
    setCurrentStep(-1);
  }, []);

  const handleSkip = useCallback(() => {
    handleComplete();
  }, [handleComplete]);

  if (!isActive || currentStep < 0 || currentStep >= ONBOARDING_STEPS.length) return null;

  const step = ONBOARDING_STEPS[currentStep];

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-[9998]"
        onClick={handleSkip}
        role="presentation"
      />

      {/* Tooltip */}
      <div
        className="fixed z-[9999] bg-background border border-border rounded-lg shadow-xl p-4 max-w-sm animate-in fade-in slide-in-from-bottom-2"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
        role="dialog"
        aria-label={`Onboarding step ${currentStep + 1} of ${ONBOARDING_STEPS.length}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono text-muted-foreground">
            {currentStep + 1}/{ONBOARDING_STEPS.length}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label="Skip onboarding"
          >
            Skip
          </button>
        </div>

        <h3 className="text-base font-semibold mb-1">{step.title}</h3>
        <p className="text-sm text-muted-foreground mb-4">{step.description}</p>

        <div className="flex items-center gap-2">
          {currentStep > 0 && (
            <Button variant="outline" size="sm" onClick={() => setCurrentStep(prev => prev - 1)}>
              Back
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" onClick={handleNext}>
            {currentStep < ONBOARDING_STEPS.length - 1 ? "Next" : "Get Started"}
          </Button>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1 mt-3">
          {ONBOARDING_STEPS.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === currentStep ? "bg-primary" : i < currentStep ? "bg-primary/50" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function useStartOnboarding() {
  return () => {
    localStorage.removeItem(ONBOARDING_KEY);
    window.location.reload();
  };
}
