/**
 * DuplicateComplaintPicker — autocomplete search-select for complaints that
 * are duplicates of the one being triaged. Backed by the existing
 * trpc.publicComplaints.list search (no new endpoint needed). Replaces raw
 * numeric complaint-id entry in the merge-duplicates flow.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PickerCombobox, type PickerOption } from "./PickerCombobox";

interface DuplicateComplaintPickerProps {
  value: PickerOption | null;
  onChange: (opt: PickerOption | null) => void;
  /** The canonical complaint being triaged — excluded from options. */
  excludeId?: number;
  placeholder?: string;
  disabled?: boolean;
}

export function DuplicateComplaintPicker({
  value,
  onChange,
  excludeId,
  placeholder = "Select duplicate complaint…",
  disabled,
}: DuplicateComplaintPickerProps) {
  const [query, setQuery] = useState("");
  const results = trpc.publicComplaints.list.useQuery(
    { search: query || undefined, page: 1, limit: 10 },
    { staleTime: 15_000 },
  );

  const rows: any[] = (results.data as any)?.data ?? [];
  const options: PickerOption[] = rows.map((c: any) => ({
    id: c.id,
    label: `${c.reference_code} — ${c.subject}`,
    sublabel: c.controller_name ?? undefined,
    badge: String(c.status).replaceAll("_", " "),
  }));

  return (
    <PickerCombobox
      value={value}
      onChange={onChange}
      onQueryChange={setQuery}
      options={options}
      loading={results.isFetching}
      placeholder={placeholder}
      searchPlaceholder="Search reference or subject…"
      emptyText="No complaints match."
      disabled={disabled}
      excludeIds={excludeId != null ? [excludeId] : undefined}
    />
  );
}
