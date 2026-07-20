import fs from "node:fs";
import path from "node:path";

import {
  clonePermittingPlatform,
  type PermitCaseRecord,
  type PermitStage,
  type PermittingPlatformSnapshot,
} from "../lib/permitting-domain";

const DATA_DIR = path.join(process.cwd(), "server", "data");
const STORE_PATH = path.join(DATA_DIR, "permitting-platform.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(clonePermittingPlatform(), null, 2));
  }
}

function readStore(): PermittingPlatformSnapshot {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw) as PermittingPlatformSnapshot;
  } catch {
    const fallback = clonePermittingPlatform();
    fs.writeFileSync(STORE_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function writeStore(store: PermittingPlatformSnapshot) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function buildTimeline(stage: PermitStage, updatedAt: string) {
  const order: PermitStage[] = [
    "intake",
    "spatial_clearance",
    "technical_review",
    "environmental_review",
    "agency_coordination",
    "payment_pending",
    "approval",
    "issued",
    "active_monitoring",
  ];
  const labels: Record<PermitStage, string> = {
    intake: "Unified intake",
    spatial_clearance: "Spatial clearance",
    technical_review: "Technical review",
    environmental_review: "Environmental review",
    agency_coordination: "Agency coordination",
    payment_pending: "Payment confirmation",
    approval: "Approval decision",
    issued: "Permit issued",
    active_monitoring: "Active monitoring",
  };
  const rank = order.indexOf(stage);
  return order.map((key, index) => ({
    key,
    label: labels[key],
    completed: index <= rank,
    timestamp: index <= rank ? updatedAt : undefined,
  }));
}

export function getPermittingPlatform() {
  return readStore();
}

export function listPermitCases() {
  return readStore().permitCases;
}

export function getPermitCase(caseId: string) {
  return readStore().permitCases.find((item) => item.id === caseId) ?? null;
}

export function listAgencies() {
  return readStore().agencies;
}

export function listMiddlewareComponents() {
  return readStore().middleware;
}

export function listServiceTopology() {
  return readStore().services;
}

export function listParityState() {
  return readStore().parity;
}

export function updatePermitCaseStage(input: { caseId: string; stage: PermitStage }) {
  const store = readStore();
  const record = store.permitCases.find((item) => item.id === input.caseId);
  if (!record) throw new Error("Permit case not found");
  const updatedAt = new Date().toISOString();
  record.stage = input.stage;
  record.updatedAt = updatedAt;
  record.timeline = buildTimeline(input.stage, updatedAt);
  writeStore(store);
  return record;
}

export function upsertPermitCase(input: PermitCaseRecord) {
  const store = readStore();
  const existingIndex = store.permitCases.findIndex((item) => item.id === input.id);
  if (existingIndex >= 0) {
    store.permitCases[existingIndex] = input;
  } else {
    store.permitCases.unshift(input);
  }
  writeStore(store);
  return input;
}
