/**
 * CasePicker — autocomplete search-select for enforcement cases.
 * Backed by trpc.bulkOps.searchCases (staffProcedure; case reference /
 * organisation name / exact id). Replaces raw numeric case-id entry in
 * complaint triage.
 *
 * NOTE: `bulkOps` is mounted by the integrator in server/routers.ts; the
 * `as any` access keeps this tree compiling before that merge lands.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PickerCombobox, type PickerOption } from "./PickerCombobox";

interface CasePickerProps {
  value: PickerOption | null;
  onChange: (opt: PickerOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CasePicker({ value, onChange, placeholder = "Select enforcement case…", disabled }: CasePickerProps) {
  const [query, setQuery] = useState("");
  const results = trpc.bulkOps.searchCases.useQuery(
    { query: query || undefined, limit: 10 },
    { staleTime: 30_000 },
  );

  const options: PickerOption[] = ((results.data as any[]) ?? []).map((c: any) => ({
    id: c.id,
    label: c.case_reference ?? `Case #${c.id}`,
    sublabel: c.organization_name ?? undefined,
    badge: c.status,
  }));

  return (
    <PickerCombobox
      value={value}
      onChange={onChange}
      onQueryChange={setQuery}
      options={options}
      loading={results.isFetching}
      placeholder={placeholder}
      searchPlaceholder="Search case ref or organisation…"
      emptyText="No enforcement cases match."
      disabled={disabled}
    />
  );
}
