/**
 * OfficerPicker — autocomplete search-select for NDSEP officers.
 * Backed by trpc.bulkOps.searchOfficers (staffProcedure; active users with
 * staff/regulator roles). Replaces raw numeric user-id entry in triage UIs.
 *
 * NOTE: `bulkOps` is mounted by the integrator in server/routers.ts; the
 * `as any` access keeps this tree compiling before that merge lands.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PickerCombobox, type PickerOption } from "./PickerCombobox";

interface OfficerPickerProps {
  value: PickerOption | null;
  onChange: (opt: PickerOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function OfficerPicker({ value, onChange, placeholder = "Select officer…", disabled }: OfficerPickerProps) {
  const [query, setQuery] = useState("");
  const results = trpc.bulkOps.searchOfficers.useQuery(
    { query: query || undefined, limit: 10 },
    { staleTime: 30_000 },
  );

  const options: PickerOption[] = ((results.data as any[]) ?? []).map((u: any) => ({
    id: u.id,
    label: u.name ?? u.email ?? `User #${u.id}`,
    sublabel: u.email ?? undefined,
    badge: u.role,
  }));

  return (
    <PickerCombobox
      value={value}
      onChange={onChange}
      onQueryChange={setQuery}
      options={options}
      loading={results.isFetching}
      placeholder={placeholder}
      searchPlaceholder="Search name or email…"
      emptyText="No officers match."
      disabled={disabled}
    />
  );
}
