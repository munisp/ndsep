/**
 * Shared combobox shell for the search-select pickers (round 12, wave 2).
 * Presentational only — the concrete pickers (OfficerPicker, CasePicker,
 * DuplicateComplaintPicker) own their debounced tRPC queries and pass the
 * resulting options in.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";

export interface PickerOption {
  id: number;
  label: string;
  sublabel?: string;
  badge?: string;
}

interface PickerComboboxProps {
  value: PickerOption | null;
  onChange: (opt: PickerOption | null) => void;
  /** Called (already debounced by the parent hook boundary) when the search text changes. */
  onQueryChange: (q: string) => void;
  options: PickerOption[];
  loading?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Exclude these ids from the option list (e.g. the complaint being triaged). */
  excludeIds?: number[];
}

export function PickerCombobox({
  value,
  onChange,
  onQueryChange,
  options,
  loading = false,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyText = "No matches.",
  disabled = false,
  excludeIds,
}: PickerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the outbound query so autocomplete doesn't fire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => onQueryChange(query.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const visible = (options ?? []).filter((o) => !excludeIds?.includes(o.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>
            {value ? value.label : placeholder}
          </span>
          <span className="flex items-center gap-1 ml-2 shrink-0">
            {value && (
              <X
                className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  setQuery("");
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2" align="start">
        <div className="relative mb-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 pr-7 text-sm"
          />
          {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-56 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">{loading ? "Searching…" : emptyText}</p>
          ) : (
            visible.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${value?.id === opt.id ? "opacity-100" : "opacity-0"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  {opt.sublabel && <span className="block truncate text-xs text-muted-foreground">{opt.sublabel}</span>}
                </span>
                {opt.badge && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{opt.badge}</span>}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
