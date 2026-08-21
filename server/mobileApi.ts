/**
 * NDSEP Mobile REST API Adapter.
 *
 * Every endpoint reads or writes the canonical PostgreSQL schema. Database,
 * authorization, and query failures are explicit HTTP errors: the adapter must
 * never substitute sample scores, empty lists, or success responses.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { getPool } from "./db";
import { logger } from "./logger";
import { verifyKeycloakToken } from "./keycloak";
import { jwtVerify } from "jose";
import { getAllCircuitBreakerStates } from "./resilience";

const router = Router();

type MobileRequest = Request & { user?: { id?: number | string; role?: string; organizationId?: number | null } };

function rows(result: { rows?: unknown[] } | unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function unavailable(res: Response): void {
  res.status(503).json({ error: "Database service is unavailable" });
}

function failure(res: Response, operation: string, error: unknown): void {
  logger.error({ err: error, operation }, "[MobileAPI] endpoint failed");
  res.status(500).json({ error: `Failed to ${operation}` });
}

function numericId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function complianceGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

async function mobileAuth(req: MobileRequest, res: Response, next: NextFunction): Promise<void> {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Bearer token required" });
    return;
  }

  const token = authorization.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: "Bearer token required" });
    return;
  }

  try {
    const keycloakUser = await verifyKeycloakToken(token);
    if (keycloakUser) {
      req.user = { id: `kc:${keycloakUser.sub}`, role: keycloakUser.roles.includes("admin") ? "admin" : "user" };
      next();
      return;
    }
  } catch (error) {
    logger.warn({ err: error }, "[MobileAPI] Keycloak verification failed");
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: "Session JWT validation is not configured" });
      return;
    }
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (!payload.id) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    req.user = { id: String(payload.id), role: typeof payload.role === "string" ? payload.role : "user" };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

router.get("/compliance/overview", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const [scoreResult, dimensionsResult] = await Promise.all([
      pool.query(`SELECT AVG(compliance_score) AS average_score FROM organizations`),
      pool.query(`SELECT compliance_status AS dimension, AVG(compliance_score) AS average_score FROM organizations GROUP BY compliance_status`),
    ]);
    const averageScore = Number(rows(scoreResult)[0]?.average_score ?? 0);
    const dimensions = Object.fromEntries(rows(dimensionsResult).map((row) => [String(row.dimension ?? "unclassified"), Number(row.average_score ?? 0)]));
    res.json({ overallScore: Math.round(averageScore), trend: "current", dimensions });
  } catch (error) {
    failure(res, "load compliance overview", error);
  }
});

router.get("/compliance/score/:orgId", mobileAuth, async (req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const orgId = numericId(req.params.orgId);
    if (!orgId) return res.status(400).json({ error: "Invalid organization id" });
    const result = await pool.query(`SELECT compliance_score, compliance_status FROM organizations WHERE id = $1`, [orgId]);
    const organization = rows(result)[0];
    if (!organization) return res.status(404).json({ error: "Organization not found" });
    const score = Number(organization.compliance_score ?? 0);
    res.json({ score, grade: complianceGrade(score), status: organization.compliance_status });
  } catch (error) {
    failure(res, "load compliance score", error);
  }
});

router.get("/compliance/audits", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, organization_id AS org_id, compliance_score AS score, car_status AS status, submitted_at AS created_at FROM compliance_audit_returns ORDER BY submitted_at DESC NULLS LAST LIMIT 50`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load compliance audits", error);
  }
});

router.get("/alerts/active", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, alert_type AS type, severity, title, detected_at AS timestamp FROM security_alerts WHERE is_resolved = false ORDER BY detected_at DESC LIMIT 50`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load active alerts", error);
  }
});

router.post("/breach/report", mobileAuth, async (req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const organizationId = numericId(req.body?.organizationId);
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (!organizationId || description.length < 10) return res.status(400).json({ error: "organizationId and a 10-character description are required" });
    const affectedSubjects = Math.max(0, Number(req.body?.affectedSubjects ?? 0));
    const dataCategories = Array.isArray(req.body?.dataCategories) ? req.body.dataCategories : [];
    const severity = ["low", "medium", "high", "critical"].includes(req.body?.severity) ? req.body.severity : "medium";
    const result = await pool.query(
      `INSERT INTO breach_incidents (organization_id, title, description, breach_incident_severity, breach_incident_status, detected_at, affected_individuals_count, data_types_affected)
       VALUES ($1, $2, $3, $4, 'detected', NOW(), $5, $6) RETURNING id, breach_incident_status`,
      [organizationId, description.slice(0, 255), description, severity, affectedSubjects, JSON.stringify(dataCategories)],
    );
    const created = rows(result)[0];
    res.status(201).json({ id: created?.id, status: created?.breach_incident_status });
  } catch (error) {
    failure(res, "report breach", error);
  }
});

router.get("/breach/list", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, organization_id, description, breach_incident_severity AS severity, breach_incident_status AS status, affected_individuals_count AS affected_subjects, detected_at FROM breach_incidents ORDER BY detected_at DESC LIMIT 100`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load breaches", error);
  }
});

router.post("/dsar/submit", mobileAuth, async (req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const organizationId = numericId(req.body?.organizationId);
    const subjectName = typeof req.body?.subjectName === "string" ? req.body.subjectName.trim() : "";
    const subjectEmail = typeof req.body?.subjectEmail === "string" ? req.body.subjectEmail.trim() : "";
    if (!organizationId || !subjectName || !subjectEmail) return res.status(400).json({ error: "organizationId, subjectName, and subjectEmail are required" });
    const requestType = ["access", "erasure", "portability", "rectification", "restriction", "objection"].includes(req.body?.requestType) ? req.body.requestType : "access";
    const result = await pool.query(
      `INSERT INTO citizen_requests (citizen_name, citizen_email, request_type, organization_id, description, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, 'submitted', NOW()) RETURNING id, status, response_deadline`,
      [subjectName, subjectEmail, requestType, organizationId, typeof req.body?.details === "string" ? req.body.details : null],
    );
    const created = rows(result)[0];
    res.status(201).json({ id: created?.id, status: created?.status, responseDeadline: created?.response_deadline });
  } catch (error) {
    failure(res, "submit DSAR", error);
  }
});

router.get("/dsar/list", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, citizen_name, request_type, status, submitted_at FROM citizen_requests ORDER BY submitted_at DESC LIMIT 100`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load DSARs", error);
  }
});

router.get("/metrics/platform", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const [orgs, cases, breaches, scores] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS count FROM organizations`),
      pool.query(`SELECT COUNT(*) AS count FROM enforcement_cases WHERE closed_at IS NULL`),
      pool.query(`SELECT COUNT(*) AS count FROM breach_incidents WHERE detected_at > NOW() - INTERVAL '30 days'`),
      pool.query(`SELECT AVG(compliance_score) AS average_score FROM organizations`),
    ]);
    res.json({
      totalOrgs: Number(rows(orgs)[0]?.count ?? 0),
      activeCases: Number(rows(cases)[0]?.count ?? 0),
      breaches30d: Number(rows(breaches)[0]?.count ?? 0),
      avgCompliance: Math.round(Number(rows(scores)[0]?.average_score ?? 0)),
    });
  } catch (error) {
    failure(res, "load platform metrics", error);
  }
});

router.get("/noc/status", mobileAuth, (_req: MobileRequest, res: Response) => {
  const services = getAllCircuitBreakerStates().map((state) => ({
    serviceName: state.name,
    status: state.state === "CLOSED" ? "healthy" : state.state === "HALF_OPEN" ? "recovering" : "degraded",
    failures: state.failures,
    lastOpenedAt: state.lastOpenedAt,
  }));
  const status = services.some((service) => service.status === "degraded") ? "degraded" : "operational";
  res.json({ status, services });
});

router.post("/noc/alerts/:alertId/acknowledge", mobileAuth, async (req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const alertId = numericId(req.params.alertId);
    if (!alertId) return res.status(400).json({ error: "Invalid alert id" });
    const result = await pool.query(`UPDATE security_alerts SET is_resolved = true, resolved_at = NOW() WHERE id = $1 AND is_resolved = false`, [alertId]);
    if (result.rowCount !== 1) return res.status(404).json({ error: "Active alert not found" });
    res.json({ success: true });
  } catch (error) {
    failure(res, "acknowledge alert", error);
  }
});

router.get("/enforcement/cases", mobileAuth, async (req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (typeof req.query.status === "string") { parameters.push(req.query.status); conditions.push(`ec.status = $${parameters.length}`); }
    if (typeof req.query.sector === "string") { parameters.push(req.query.sector); conditions.push(`o.sector = $${parameters.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`SELECT ec.id, ec.case_reference AS case_number, ec.organization_id AS org_id, ec.status, ec.opened_at AS created_at, o.sector FROM enforcement_cases ec LEFT JOIN organizations o ON o.id = ec.organization_id ${where} ORDER BY ec.opened_at DESC LIMIT 100`, parameters);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load enforcement cases", error);
  }
});

router.get("/transfers/list", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, organization_id AS org_id, destination_country, transfer_mechanism, status, created_at FROM cross_border_transfers ORDER BY created_at DESC LIMIT 100`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load transfers", error);
  }
});

router.get("/ai-governance/models", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, name AS model_name, risk_level, status AS compliance_status, last_audit_at AS last_audit_date FROM ai_systems ORDER BY last_audit_at DESC NULLS LAST LIMIT 50`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load AI models", error);
  }
});

router.get("/banking/transactions", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, 'enforcement_penalty' AS transaction_type, amount, currency, payment_status AS status, created_at FROM financial_penalties ORDER BY created_at DESC LIMIT 100`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load payment transactions", error);
  }
});

router.get("/dpia/list", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, title, dpia_status AS status, dpia_risk_level AS risk_level, organization_id AS org_id, created_at FROM dpia_assessments ORDER BY created_at DESC LIMIT 50`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load DPIAs", error);
  }
});

router.get("/workflows/active", mobileAuth, async (_req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const result = await pool.query(`SELECT id, action_type AS workflow_type, status, violation_id AS entity_id, created_at AS started_at FROM remediation_workflows WHERE status IN ('pending', 'in_progress') ORDER BY created_at DESC LIMIT 50`);
    res.json(rows(result));
  } catch (error) {
    failure(res, "load active workflows", error);
  }
});

// Password-only login was never authenticated against a password verifier. The
// mobile client must obtain an OIDC token from Keycloak and send it as Bearer.
router.post("/auth/login", (_req: Request, res: Response) => {
  res.status(410).json({ error: "Password login is retired. Authenticate with Keycloak OIDC." });
});

router.get("/auth/verify", mobileAuth, (req: MobileRequest, res: Response) => {
  res.json({ valid: true, user: req.user });
});

router.post("/push/register", mobileAuth, async (req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const platform = typeof req.body?.platform === "string" ? req.body.platform.trim() : "";
    const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
    if (!token || !platform || !deviceId || !req.user?.id) return res.status(400).json({ error: "token, platform, deviceId, and authenticated user are required" });
    await pool.query(
      `INSERT INTO mobile_push_devices (user_id, token, platform, device_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (user_id, device_id) DO UPDATE SET token = EXCLUDED.token, platform = EXCLUDED.platform, updated_at = NOW()`,
      [String(req.user.id), token, platform, deviceId],
    );
    res.json({ success: true });
  } catch (error) {
    failure(res, "register push device", error);
  }
});

router.delete("/push/unregister", mobileAuth, async (req: MobileRequest, res: Response) => {
  try {
    const pool = getPool();
    if (!pool) return unavailable(res);
    if (!req.user?.id) return res.status(401).json({ error: "Authenticated user required" });
    await pool.query(`DELETE FROM mobile_push_devices WHERE user_id = $1`, [String(req.user.id)]);
    res.json({ success: true });
  } catch (error) {
    failure(res, "unregister push device", error);
  }
});

export function registerMobileApi(app: { use: (...args: any[]) => void }): void {
  app.use("/api/v2", router);
  logger.info("[MobileAPI] REST API v2 endpoints registered");
}
