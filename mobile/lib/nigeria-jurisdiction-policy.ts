export type NigeriaJurisdictionKey = "lagos" | "fct" | "kano" | "ogun" | "rivers";

export type JurisdictionPermitPolicy = {
  jurisdiction: NigeriaJurisdictionKey;
  label: string;
  slaHours: number;
  checklist: string[];
  disclaimer: string;
};

export const NIGERIA_JURISDICTION_POLICIES: Record<NigeriaJurisdictionKey, JurisdictionPermitPolicy> = {
  lagos: { jurisdiction: "lagos", label: "Lagos pilot workflow", slaHours: 120, checklist: ["Parcel and applicant reference captured", "Planning and land-interface review assigned", "Right-of-way or infrastructure conflict screened", "Supervisor decision recorded"], disclaimer: "Local configurable pilot policy; it is not an official Lagos approval rule or registry confirmation." },
  fct: { jurisdiction: "fct", label: "FCT pilot workflow", slaHours: 120, checklist: ["Abuja location reference captured", "Land and planning-interface review assigned", "Infrastructure corridor conflict screened", "Supervisor decision recorded"], disclaimer: "Local configurable pilot policy; it is not an official FCT approval rule or registry confirmation." },
  kano: { jurisdiction: "kano", label: "Kano pilot workflow", slaHours: 144, checklist: ["Location and applicant reference captured", "Land-use and planning-interface review assigned", "Community or access concern recorded", "Supervisor decision recorded"], disclaimer: "Local configurable pilot policy; it is not an official Kano approval rule or registry confirmation." },
  ogun: { jurisdiction: "ogun", label: "Ogun pilot workflow", slaHours: 144, checklist: ["Parcel reference captured", "Industrial, housing, or corridor interface classified", "Environmental or access concern recorded", "Supervisor decision recorded"], disclaimer: "Local configurable pilot policy; it is not an official Ogun approval rule or registry confirmation." },
  rivers: { jurisdiction: "rivers", label: "Rivers pilot workflow", slaHours: 96, checklist: ["Location reference captured", "Waterfront, infrastructure, or extractive interface classified", "Community concern recorded", "Supervisor decision recorded"], disclaimer: "Local configurable pilot policy; it is not an official Rivers approval rule or registry confirmation." },
};

export function getJurisdictionPolicy(jurisdiction: NigeriaJurisdictionKey | "all") {
  return jurisdiction === "all" ? null : NIGERIA_JURISDICTION_POLICIES[jurisdiction];
}

export function assessJurisdictionSla(submittedAt: string, policy: JurisdictionPermitPolicy, now = new Date()) {
  const dueAt = new Date(new Date(submittedAt).getTime() + policy.slaHours * 60 * 60 * 1000);
  const hoursRemaining = Math.ceil((dueAt.getTime() - now.getTime()) / (60 * 60 * 1000));
  return { dueAt: dueAt.toISOString(), hoursRemaining, status: hoursRemaining < 0 ? "breached" as const : hoursRemaining <= 24 ? "due_soon" as const : "within_sla" as const };
}
