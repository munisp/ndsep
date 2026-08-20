import { TRPCError } from "@trpc/server";
import { logger } from "../logger";

/**
 * Open Policy Agent (OPA) decision client for high-risk NDSEP actions.
 *
 * OPA supplements, rather than replaces, authenticated identity, local PBAC,
 * and Permify relationship checks. In production, an unavailable or malformed
 * OPA response is always a denial.
 */
const OPA_URL = process.env.OPA_URL;
const OPA_TOKEN = process.env.OPA_TOKEN;
const OPA_DECISION_PATH = process.env.OPA_DECISION_PATH ?? "/v1/data/ndsep/authz/allow";
const OPA_ENABLED = process.env.OPA_ENABLED === "true";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const OPA_TIMEOUT_MS = Number(process.env.OPA_TIMEOUT_MS ?? "1500");

export type OpaAction = "admin" | "approve" | "delete" | "export" | "write";

export interface OpaDecisionInput {
  subject: {
    id: string | number;
    role: string;
    authenticated: boolean;
  };
  action: OpaAction;
  resource: string;
  context: {
    environment: string;
    mfaVerified: boolean;
    requestId?: string;
    sourceIp?: string;
    method?: string;
  };
}

function opaConfigured(): boolean {
  return OPA_ENABLED && Boolean(OPA_URL);
}

/**
 * Return an explicit OPA allow decision. The function intentionally returns
 * false on transport, HTTP, parsing, or decision-shape failure.
 */
export async function opaAllows(input: OpaDecisionInput): Promise<boolean> {
  if (!opaConfigured()) {
    if (IS_PRODUCTION) {
      logger.error("[opa] Production authorization is not configured; denying privileged action");
      return false;
    }
    // Local development and isolated unit tests use the in-process PBAC layer.
    return true;
  }

  try {
    const response = await fetch(`${OPA_URL}${OPA_DECISION_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OPA_TOKEN ? { Authorization: `Bearer ${OPA_TOKEN}` } : {}),
      },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(OPA_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "[opa] Policy decision request failed");
      return false;
    }

    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("result" in body)) {
      logger.warn("[opa] Policy decision response was malformed");
      return false;
    }

    return (body as { result?: unknown }).result === true;
  } catch (error) {
    logger.warn({ err: error }, "[opa] Policy decision unavailable; denying request");
    return false;
  }
}

export async function requireOpaDecision(input: OpaDecisionInput): Promise<void> {
  if (!(await opaAllows(input))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Policy decision denied or unavailable",
    });
  }
}

export function buildOpaInput(
  user: { id: string | number; role: string },
  action: OpaAction,
  resource: string,
  request?: { id?: string; ip?: string; method?: string; mfaVerified?: boolean },
): OpaDecisionInput {
  return {
    subject: {
      id: user.id,
      role: user.role,
      authenticated: true,
    },
    action,
    resource,
    context: {
      environment: process.env.NODE_ENV ?? "development",
      mfaVerified: request?.mfaVerified === true,
      requestId: request?.id,
      sourceIp: request?.ip,
      method: request?.method,
    },
  };
}

export function opaStatus(): { enabled: boolean; configured: boolean; required: boolean; decisionPath: string } {
  return {
    enabled: OPA_ENABLED,
    configured: opaConfigured(),
    required: IS_PRODUCTION,
    decisionPath: OPA_DECISION_PATH,
  };
}
