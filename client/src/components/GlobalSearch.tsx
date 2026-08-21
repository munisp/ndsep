import React, { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, X, Loader2, Building2, AlertTriangle, FileText, Users, Shield } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  type: string;
  href: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  bank: <Building2 className="h-4 w-4" />,
  aml_case: <AlertTriangle className="h-4 w-4 text-red-500" />,
  fine: <FileText className="h-4 w-4 text-orange-500" />,
  kyc: <Users className="h-4 w-4 text-blue-500" />,
  accreditation: <Shield className="h-4 w-4 text-green-500" />,
  default: <Search className="h-4 w-4 text-muted-foreground" />,
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  // Debounce query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: searchData, isLoading } = (trpc.banking as any).search?.useQuery(
    { query: debouncedQuery, limit: 8 },
    {
      enabled: debouncedQuery.length >= 2,
      staleTime: 30_000,
    }
  ) ?? { data: null, isLoading: false };

  const results: SearchResult[] = React.useMemo(() => {
    if (!searchData) return [];
    const items: SearchResult[] = [];

    // Banks
    if (Array.isArray((searchData as any)?.banks)) {
      for (const b of (searchData as any).banks) {
        items.push({
          id: b.id,
          title: b.name,
          subtitle: `${b.bank_type ?? "Bank"} · ${b.cbn_license_number ?? ""}`,
          type: "bank",
          href: "/banking",
          badge: b.compliance_status,
          badgeVariant: b.compliance_status === "compliant" ? "default" : "destructive",
        });
      }
    }

    // AML cases
    if (Array.isArray((searchData as any)?.amlCases)) {
      for (const a of (searchData as any).amlCases) {
        items.push({
          id: a.id,
          title: a.case_ref ?? `AML Case ${a.id}`,
          subtitle: a.subject_name,
          type: "aml_case",
          href: "/aml-cases",
          badge: a.status,
          badgeVariant: a.status === "closed" ? "secondary" : "destructive",
        });
      }
    }

    return items.slice(0, 8);
  }, [searchData]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      navigate(result.href);
      setOpen(false);
      setQuery("");
    },
    [navigate]
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">Search NDSEP…</span>
        <kbd className="hidden rounded bg-background px-1.5 py-0.5 text-xs font-mono md:inline">
          ⌘K
        </kbd>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[480px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background shadow-xl">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search banks, AML cases, fines, KYC records…"
              className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              autoFocus
            />
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto py-1">
            {debouncedQuery.length < 2 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search…
              </div>
            ) : results.length === 0 && !isLoading ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No results found for "{debouncedQuery}"
              </div>
            ) : (
              results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleSelect(result)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="flex-shrink-0 text-muted-foreground">
                    {TYPE_ICONS[result.type] ?? TYPE_ICONS.default}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{result.title}</div>
                    {result.subtitle && (
                      <div className="truncate text-xs text-muted-foreground">{result.subtitle}</div>
                    )}
                  </div>
                  {result.badge && (
                    <Badge variant={result.badgeVariant ?? "secondary"} className="flex-shrink-0 text-xs">
                      {result.badge}
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>↑↓ Navigate · Enter Select · Esc Close</span>
            <span>Powered by OpenSearch</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default GlobalSearch;
