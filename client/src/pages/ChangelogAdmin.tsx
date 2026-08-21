import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Sparkles, ShieldAlert } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
type Category = "feature" | "security" | "improvement" | "bugfix" | "compliance";

const CATEGORY_COLORS: Record<Category, string> = {
  feature: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  security: "bg-red-500/10 text-red-600 border-red-500/20",
  improvement: "bg-green-500/10 text-green-600 border-green-500/20",
  bugfix: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  compliance: "bg-purple-500/10 text-purple-600 border-purple-500/20",
};

interface ChangelogEntry {
  id: number;
  version: string;
  title: string;
  body: string;
  category: string;
  published_at: string;
}

interface EntryFormState {
  version: string;
  title: string;
  body: string;
  category: Category;
  publishedAt: string;
}

const EMPTY_FORM: EntryFormState = {
  version: "",
  title: "",
  body: "",
  category: "feature",
  publishedAt: new Date().toISOString().slice(0, 16),
};

export default function ChangelogAdmin() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [createOpen, setCreateOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<ChangelogEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ChangelogEntry | null>(null);
  const [form, setForm] = useState<EntryFormState>(EMPTY_FORM);

  const { data, isLoading } = trpc.changelogAdmin.listAll.useQuery(
    { limit: 50, offset: 0 },
    { enabled: user?.role === "admin" }
  );

  const createMutation = trpc.changelogAdmin.create.useMutation({
    onSuccess: () => {
      toast.success("Changelog entry created");
      utils.changelogAdmin.listAll.invalidate();
      utils.changelog.list.invalidate();
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.changelogAdmin.update.useMutation({
    onSuccess: () => {
      toast.success("Changelog entry updated");
      utils.changelogAdmin.listAll.invalidate();
      utils.changelog.list.invalidate();
      setEditEntry(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.changelogAdmin.delete.useMutation({
    onSuccess: () => {
      toast.success("Changelog entry deleted");
      utils.changelogAdmin.listAll.invalidate();
      utils.changelog.list.invalidate();
      setDeleteEntry(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!form.version || !form.title || !form.body) {
      toast.error("Version, title, and body are required");
      return;
    }
    createMutation.mutate({
      version: form.version,
      title: form.title,
      body: form.body,
      category: form.category,
      publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : undefined,
    });
  };

  const handleUpdate = () => {
    if (!editEntry) return;
    updateMutation.mutate({
      id: editEntry.id,
      version: form.version || undefined,
      title: form.title || undefined,
      body: form.body || undefined,
      category: form.category || undefined,
      publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : undefined,
    });
  };

  const openEdit = (entry: ChangelogEntry) => {
    setEditEntry(entry);
    setForm({
      version: entry.version,
      title: entry.title,
      body: entry.body,
      category: entry.category as Category,
      publishedAt: new Date(entry.published_at).toISOString().slice(0, 16),
    });
  };

  // Access guard
  if (user && user.role !== "admin") {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
          <ShieldAlert className="h-16 w-16 text-destructive" />
          <h2 className="text-2xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground max-w-sm">
            This page is restricted to NDPC administrators. Contact your system administrator to
            request access.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Changelog Management</h1>
              <p className="text-sm text-muted-foreground">
                Publish platform updates visible to all users via the "What's New" modal
              </p>
            </div>
          </div>
          <Button onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" />
            New Entry
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["feature", "security", "improvement", "bugfix"] as Category[]).map((cat) => {
            const count = data?.entries.filter((e) => e.category === cat).length ?? 0;
            return (
              <div key={cat} className="border rounded-lg p-4 space-y-1">
                <span className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${CATEGORY_COLORS[cat]}`}>
                  {cat}
                </span>
                <p className="text-2xl font-bold">{count}</p>
              </div>
            );
          })}
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Version</TableHead>
                <TableHead className="w-28">Category</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-36">Published</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <div className="h-4 bg-muted animate-pulse rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data?.entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No changelog entries yet. Click "New Entry" to publish the first one.
                  </TableCell>
                </TableRow>
              ) : (
                data?.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <span className="font-mono text-xs font-bold bg-muted px-2 py-0.5 rounded">
                        {entry.version}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${
                        CATEGORY_COLORS[entry.category as Category] ?? "bg-muted text-muted-foreground border-border"
                      }`}>
                        {entry.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{entry.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">{entry.body}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(entry.published_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(entry)}
                          aria-label="Edit entry"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteEntry(entry)}
                          aria-label="Delete entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Changelog Entry</DialogTitle>
            <DialogDescription>
              This entry will appear in the "What's New" modal for all users.
            </DialogDescription>
          </DialogHeader>
          <EntryForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Publishing..." : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editEntry} onOpenChange={(v) => { if (!v) setEditEntry(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Changelog Entry</DialogTitle>
          </DialogHeader>
          <EntryForm form={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteEntry} onOpenChange={(v) => { if (!v) setDeleteEntry(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Entry</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteEntry?.title}</strong>? This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteEntry(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteEntry && deleteMutation.mutate({ id: deleteEntry.id })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Shared form component ─────────────────────────────────────────────────────
function EntryForm({
  form,
  onChange,
}: {
  form: EntryFormState;
  onChange: (f: EntryFormState) => void;
}) {
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Admin", href: "/" }, { label: "Changelog Admin" }]} className="mb-4" />
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Version *</Label>
          <Input
            placeholder="e.g. v15.0"
            value={form.version}
            onChange={(e) => onChange({ ...form, version: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Category *</Label>
          <Select
            value={form.category}
            onValueChange={(v) => onChange({ ...form, category: v as Category })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feature">Feature</SelectItem>
              <SelectItem value="security">Security</SelectItem>
              <SelectItem value="improvement">Improvement</SelectItem>
              <SelectItem value="bugfix">Bug Fix</SelectItem>
              <SelectItem value="compliance">Compliance</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Title *</Label>
        <Input
          placeholder="Brief description of the change"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Body *</Label>
        <Textarea
          placeholder="Detailed description of what changed and why it matters..."
          value={form.body}
          onChange={(e) => onChange({ ...form, body: e.target.value })}
          rows={4}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Published At</Label>
        <Input
          type="datetime-local"
          value={form.publishedAt}
          onChange={(e) => onChange({ ...form, publishedAt: e.target.value })}
        />
      </div>
    </div>
  );
}
