import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";

const STORAGE_KEY = "ndsep_whats_new_seen_v";

const CATEGORY_COLORS: Record<string, string> = {
  feature: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  security: "bg-red-500/10 text-red-600 border-red-500/20",
  improvement: "bg-green-500/10 text-green-600 border-green-500/20",
  bugfix: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  compliance: "bg-purple-500/10 text-purple-600 border-purple-500/20",
};

export function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  const { data: entries } = trpc.changelog.list.useQuery({ limit: 5 });
  const markSeenMutation = trpc.changelog.markSeen.useMutation();

  useEffect(() => {
    if (!entries || entries.length === 0) return;
    const latestVersion = entries[0]?.version;
    if (!latestVersion) return;

    const seenVersion = sessionStorage.getItem(STORAGE_KEY);
    if (seenVersion !== latestVersion) {
      // Show modal after a short delay so the page can load
      const timer = setTimeout(() => setOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [entries]);

  const handleClose = () => {
    const latestVersion = entries?.[0]?.version;
    if (latestVersion) {
      sessionStorage.setItem(STORAGE_KEY, latestVersion);
      markSeenMutation.mutate({ version: latestVersion });
    }
    setOpen(false);
  };

  if (!entries || entries.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <DialogTitle>What&apos;s New in NDSEP</DialogTitle>
          </div>
          <DialogDescription>
            Latest platform updates and improvements
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {entries.map((entry) => (
            <div key={entry.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    v{entry.version}
                  </span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${
                      CATEGORY_COLORS[entry.category] ?? "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    {entry.category}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.published_at).toLocaleDateString()}
                </span>
              </div>
              <h4 className="font-semibold text-sm text-foreground">{entry.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{entry.body}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleClose} className="gap-2">
            <span>Got it</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
