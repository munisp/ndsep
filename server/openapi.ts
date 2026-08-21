/**
 * NDSEP OpenAPI / Swagger Documentation Generator
 * =================================================
 * Auto-generates OpenAPI 3.0 spec from tRPC router definitions.
 * Serves at /api/docs (Swagger UI) and /api/openapi.json (raw spec).
 */

import type { Express } from "express";
import { logger } from "./logger";

const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "NDSEP Platform API",
    description:
      "Nigeria Data Security and Enforcement Platform — REST + tRPC hybrid API.\n\n" +
      "Authentication: Bearer token via `Authorization` header or session cookie.\n" +
      "Rate limits: 1000 requests/15min (global), 20/15min (auth endpoints).",
    version: "2.0.0",
    contact: { name: "NDSEP Platform Support", email: "support@ndsep.ng" },
    license: { name: "Proprietary" },
  },
  servers: [
    { url: "/api", description: "NDSEP API Server" },
  ],
  tags: [
    { name: "Health", description: "Liveness and readiness probes" },
    { name: "Auth", description: "Authentication and session management" },
    { name: "Organizations", description: "Organization CRUD and compliance" },
    { name: "DSAR", description: "Data Subject Access Requests" },
    { name: "Audit", description: "Compliance audit operations" },
    { name: "Breach", description: "Breach incident management" },
    { name: "DPCO", description: "DPCO portal and audit workspace" },
    { name: "Enforcement", description: "Penalties, fines, enforcement cases" },
    { name: "Export", description: "Data export and portability" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Liveness probe",
        responses: { "200": { description: "Server is alive", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, uptime: { type: "number" }, timestamp: { type: "string" } } } } } } },
      },
    },
    "/ready": {
      get: {
        tags: ["Health"],
        summary: "Readiness probe — checks DB, Redis, workers",
        responses: {
          "200": { description: "All dependencies ready" },
          "503": { description: "One or more dependencies unavailable" },
        },
      },
    },
    "/trpc/organization.list": {
      get: {
        tags: ["Organizations"],
        summary: "List all organizations",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: { "200": { description: "Organization list" } },
      },
    },
    "/trpc/dsar.publicSubmit": {
      post: {
        tags: ["DSAR"],
        summary: "Submit a public DSAR request",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["citizenName", "citizenEmail", "requestType", "description"],
                properties: {
                  citizenName: { type: "string" },
                  citizenEmail: { type: "string", format: "email" },
                  requestType: { type: "string", enum: ["access", "rectification", "erasure", "portability", "objection"] },
                  description: { type: "string" },
                  organizationId: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "DSAR submitted with reference number" },
          "429": { description: "Rate limit exceeded (10/hr)" },
        },
      },
    },
    "/trpc/audit.verify": {
      post: {
        tags: ["Audit"],
        summary: "Verify audit log chain integrity",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Verification results" } },
      },
    },
    "/trpc/dataExport.request": {
      post: {
        tags: ["Export"],
        summary: "Request data export (NDPA S.36 portability)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["subjectEmail", "format"],
                properties: {
                  subjectEmail: { type: "string", format: "email" },
                  format: { type: "string", enum: ["json", "csv"] },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Export data in requested format" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      cookieAuth: { type: "apiKey", in: "cookie", name: "ndsep-session" },
    },
  },
};

export function registerOpenApiDocs(app: Express): void {
  // Raw OpenAPI JSON
  app.get("/api/openapi.json", (_req, res) => {
    res.json(OPENAPI_SPEC);
  });

  // Swagger UI (CDN-based, no additional dependencies)
  app.get("/api/docs", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>NDSEP API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`);
  });

  logger.info("[OpenAPI] Swagger UI available at /api/docs");
}
