import { useState, useCallback } from "react";
import DOMPurify from "dompurify";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Search, Building2, AlertTriangle, FileText, Shield, User, ArrowRight, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useDebouncedCallback } from "use-debounce";

// Sanitize HTML to prevent XSS — only allow safe inline tags, no attributes
const sanitizeHtml = (html: string) => ({
  __html: DOMPurify.sanitize(html, { ALLOWED_TAGS: ["b", "em", "mark", "span"], ALLOWED_ATTR: [] }),
});

const TYPE_ICONS: Record<string, React.ReactNode> = {
  organization: <Building2 className="w-4 h-4 text-blue-400" />,
  violation: <AlertTriangle className="w-4 h-4 text-orange-400" />,
  enforcement_case: <FileText className="w-4 h-4 text-red-400" />,
  dpco: <Shield className="w-4 h-4 text-green-400" />,
  citizen_request: <User className="w-4 h-4 text-purple-400" />,
};

const TYPE_LABELS: Record<string, string> = {
  organization: "Organisation",
  violation: "Violation",
  enforcement_case: "Enforcement Case",
  dpco: "DPCO",
  citizen_request: "Citizen Request",
};

const TYPE_COLORS: Record<string, string> = {
  organization: "bg-blue-900/30 text-blue-400",
  violation: "bg-orange-900/30 text-orange-400",
  enforcement_case: "bg-red-900/30 text-red-400",
  dpco: "bg-green-900/30 text-green-400",
  citizen_request: "bg-purple-900/30 text-purple-400",
};

const TYPE_ROUTES: Record<string, string> = {
  organization: "/organizations",
  violation: "/violations",
  enforcement_case: "/enforcement-cases",
  dpco: "/dpco",
  citizen_request: "/citizen-rights",
};

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [, navigate] = useLocation();

  const debounce = useDebouncedCallback((q: string) => setDebouncedQuery(q), 300);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    debounce(e.target.value);
  }, [debounce]);

  const { data: results, isLoading } = trpc.search.global.useQuery(
    { query: debouncedQuery, limit: 20 },
    { enabled: debouncedQuery.length >= 2 }
  );

  const grouped = (results as any[] ?? []).reduce((acc: Record<string, any[]>, r: any) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Search className="w-7 h-7 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Global Search</h1>
            <p className="text-sm text-muted-foreground">Search across organisations, violations, enforcement cases, DPCOs, and citizen requests</p>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            value={query}
            onChange={handleChange}
            className="bg-background border-border text-foreground pl-12 h-12 text-base"
            placeholder="Search anything... (min 2 characters)"
            autoFocus
          />
          {isLoading && (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-blue-400" />
          )}
        </div>

        {debouncedQuery.length >= 2 && !isLoading && (results as any[] ?? []).length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No results found for "<span className="text-muted-foreground">{debouncedQuery}</span>"</p>
          </div>
        )}

        {debouncedQuery.length < 2 && (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Start typing to search across the platform</p>
          </div>
        )}

        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              {TYPE_ICONS[type]}
              <span className="text-sm font-medium text-muted-foreground">{TYPE_LABELS[type] ?? type} ({items.length})</span>
            </div>
            <div className="space-y-2">
              {items.map((item: any) => (
                <button
                  key={`${type}-${item.id}`}
                  onClick={() => navigate(`${TYPE_ROUTES[type] ?? "/"}/${item.id}`)}
                  className="w-full bg-background border border-border hover:border-border rounded-xl px-4 py-3 text-left flex items-center justify-between transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{TYPE_ICONS[type]}</div>
                    <div>
                      {/* XSS-safe: DOMPurify strips all dangerous tags/attributes */}
                      <div
                        className="font-medium text-foreground text-sm group-hover:text-blue-300 transition-colors"
                        dangerouslySetInnerHTML={sanitizeHtml(item.headline ?? item.title ?? item.name ?? `#${item.id}`)}
                      />
                      {item.snippet && (
                        <div
                          className="text-muted-foreground text-xs mt-0.5 line-clamp-2"
                          dangerouslySetInnerHTML={sanitizeHtml(item.snippet)}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[type] ?? "bg-card text-muted-foreground"}`}>
                      {TYPE_LABELS[type] ?? type}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-muted-foreground transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
