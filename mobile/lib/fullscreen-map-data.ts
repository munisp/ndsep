import type { ParcelRecord } from "@/lib/mobile-data";

export type OverlayKey = "housing" | "row" | "mining" | "infrastructure";
export type StateKey = "lagos" | "fct" | "kano";
export type LayerKey = "parcels" | "boundaries" | "districts";

export type OverlayDefinition = {
  key: OverlayKey;
  label: string;
  color: string;
  description: string;
  points: Array<[number, number]>;
};

export type StateDefinition = {
  key: StateKey;
  label: string;
  summary: string;
  center: [number, number];
  zoom: number;
  boundary: Array<[number, number]>;
  districtLines: Array<Array<[number, number]>>;
};

export const overlayDefinitions: OverlayDefinition[] = [
  {
    key: "housing",
    label: "Housing growth corridor",
    color: "#2563EB",
    description: "Priority housing expansion and C of O regularisation belt.",
    points: [
      [6.62, 3.84],
      [6.59, 3.91],
      [6.56, 4.02],
      [6.54, 4.08],
    ],
  },
  {
    key: "row",
    label: "Right-of-way review",
    color: "#D97706",
    description: "Transport and utility right-of-way conflict review corridor.",
    points: [
      [9.11, 7.3],
      [9.09, 7.36],
      [9.07, 7.41],
      [9.04, 7.47],
    ],
  },
  {
    key: "mining",
    label: "Mining oversight corridor",
    color: "#7C3AED",
    description: "Illustrative extractives oversight corridor for license monitoring.",
    points: [
      [11.95, 8.44],
      [11.98, 8.49],
      [12.01, 8.55],
      [12.03, 8.61],
    ],
  },
  {
    key: "infrastructure",
    label: "Infrastructure delivery corridor",
    color: "#0F766E",
    description: "Capital works and resettlement coordination corridor.",
    points: [
      [6.83, 3.08],
      [6.82, 3.13],
      [6.81, 3.18],
      [6.8, 3.23],
    ],
  },
];

export const stateDefinitions: StateDefinition[] = [
  {
    key: "lagos",
    label: "Lagos",
    summary: "Lagos land administration, housing-growth review, corridor-sensitive approvals, and C of O throughput.",
    center: [6.56, 3.75],
    zoom: 9,
    boundary: [
      [6.37, 2.78],
      [6.41, 3.15],
      [6.49, 3.48],
      [6.63, 3.87],
      [6.68, 4.1],
      [6.53, 4.28],
      [6.35, 4.12],
      [6.29, 3.58],
      [6.31, 3.08],
    ],
    districtLines: [
      [
        [6.44, 3.18],
        [6.5, 3.42],
        [6.56, 3.73],
        [6.59, 4.0],
      ],
      [
        [6.36, 3.44],
        [6.49, 3.56],
        [6.63, 3.64],
      ],
    ],
  },
  {
    key: "fct",
    label: "FCT",
    summary: "FCT parcel review, statutory title continuity, area-council regularisation, and capital-region oversight.",
    center: [8.95, 7.4],
    zoom: 10,
    boundary: [
      [9.42, 6.85],
      [9.34, 7.12],
      [9.29, 7.4],
      [9.16, 7.71],
      [8.99, 7.87],
      [8.78, 7.76],
      [8.63, 7.54],
      [8.6, 7.19],
      [8.71, 6.93],
      [8.94, 6.82],
      [9.18, 6.8],
    ],
    districtLines: [
      [
        [9.27, 7.13],
        [9.08, 7.29],
        [8.92, 7.46],
        [8.78, 7.63],
      ],
      [
        [8.74, 7.07],
        [8.93, 7.23],
        [9.16, 7.36],
      ],
    ],
  },
  {
    key: "kano",
    label: "Kano",
    summary: "Kano GIS-backed parcel digitisation, field demarcation continuity, C of O generation, and revenue modernization.",
    center: [11.94, 8.53],
    zoom: 9,
    boundary: [
      [12.36, 7.42],
      [12.41, 7.91],
      [12.33, 8.39],
      [12.16, 8.88],
      [11.88, 9.21],
      [11.55, 9.1],
      [11.41, 8.66],
      [11.44, 8.08],
      [11.58, 7.63],
      [11.87, 7.39],
    ],
    districtLines: [
      [
        [11.67, 7.83],
        [11.82, 8.14],
        [11.97, 8.45],
        [12.11, 8.78],
      ],
      [
        [11.49, 8.33],
        [11.79, 8.41],
        [12.1, 8.54],
      ],
    ],
  },
];

export function toggleOverlay(current: OverlayKey[], key: OverlayKey) {
  return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
}

export function toggleLayer(current: LayerKey[], key: LayerKey) {
  return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
}

export function stateKeyFromParcel(parcel: ParcelRecord): StateKey | null {
  if (parcel.state === "Lagos") return "lagos";
  if (parcel.state === "FCT") return "fct";
  if (parcel.state === "Kano") return "kano";
  return null;
}

export function filterSupportedStateParcels(parcels: ParcelRecord[]) {
  return parcels.filter((parcel) => stateKeyFromParcel(parcel) !== null);
}

export function filterParcelsForState(parcels: ParcelRecord[], stateKey: StateKey) {
  return filterSupportedStateParcels(parcels).filter((parcel) => stateKeyFromParcel(parcel) === stateKey);
}

export function countTitleMix(parcels: ParcelRecord[]) {
  return parcels.reduce(
    (counts, parcel) => {
      counts[parcel.titleStatus] += 1;
      return counts;
    },
    { registered: 0, pending: 0, under_review: 0 },
  );
}
