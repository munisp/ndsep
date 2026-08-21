import { useState } from "react";
import { X, FlaskConical, LogIn, RotateCcw } from "lucide-react";
import { getLoginUrl } from "@/const";

interface DemoModeBannerProps {
  role?: "dpco" | "admin";
}

export function DemoModeBanner({ role = "dpco" }: DemoModeBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (dismissed) return null;

  const isAdmin = role === "admin";

  const handleReset = () => {
    if (resetting) return;
    setResetting(true);
    const returnTo = window.location.pathname + window.location.search;
    const roleParam = isAdmin ? "&role=admin" : "";
    window.location.href = `/api/demo-reset?returnTo=${encodeURIComponent(returnTo)}${roleParam}`;
  };

  return (
    <div
      className={`relative flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium ${
        isAdmin
          ? "bg-violet-700 text-white"
          : "bg-amber-500 text-amber-950"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <FlaskConical className="h-4 w-4 shrink-0" />
        <span>
          {isAdmin
            ? "You are in Demo Mode — NDPC Admin (read-only). All data is simulated."
            : "You are in Demo Mode — DataGuard Ltd (Demo DPCO). All data is simulated."}
        </span>
        <a
          href={getLoginUrl()}
          className={`ml-2 inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline ${
            isAdmin ? "text-violet-200 hover:text-white" : "text-amber-800 hover:text-amber-950"
          }`}
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in for full access
        </a>
        <button
          onClick={handleReset}
          disabled={resetting}
          className={`ml-2 inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline disabled:opacity-60 ${
            isAdmin ? "text-violet-200 hover:text-white" : "text-amber-800 hover:text-amber-950"
          }`}
        >
          <RotateCcw className={`h-3.5 w-3.5 ${resetting ? "animate-spin" : ""}`} />
          {resetting ? "Resetting…" : "Reset Demo Data"}
        </button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className={`rounded p-0.5 transition-colors ${
          isAdmin
            ? "hover:bg-violet-600"
            : "hover:bg-amber-400"
        }`}
        aria-label="Dismiss demo banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
