/**
 * Phase 5 Features Router
 * - Customizable Widget Dashboard
 * - Real-time AI Chat Support
 * - Interactive Tutorial System
 * - Help Article Tracking
 */
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { invokeLLM, type MessageContent } from "../_core/llm";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { logger } from "../logger";

// ── Helper: raw SQL exec ──────────────────────────────────────────────────────
async function exec(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const [rows] = await (db as any).execute(sql, params);
  return autoDecryptRows(sql, rows as Record<string, unknown>[]);
}

// ── Widget Dashboard Router ───────────────────────────────────────────────────
export const widgetDashboardRouter = router({
  // Get user's widget config
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const rows = await exec(
      `SELECT * FROM dashboard_widget_configs WHERE user_id = ? LIMIT 1`,
      [ctx.user.id]
    );
    if (rows.length === 0) {
      // Return default config
      return {
        id: null,
        userId: ctx.user.id,
        layout: [],
        widgets: [
          "breach_count", "compliance_score", "pending_dsar", "active_cases",
          "sector_breakdown", "risk_heatmap", "deadline_countdown", "recent_alerts",
          "cert_status", "nip_volume", "fine_total", "org_count"
        ],
        theme: "default"
      };
    }
    const row = rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      layout: JSON.parse(row.layout as string || "[]"),
      widgets: JSON.parse(row.widgets as string || "[]"),
      theme: row.theme as string
    };
  }),

  // Save widget config
  saveConfig: protectedProcedure
    .input(z.object({
      layout: z.array(z.object({
        id: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().optional(),
        h: z.number().optional()
      })).optional().default([]),
      widgets: z.array(z.string()),
      theme: z.enum(["default", "dark", "compact", "wide"]).default("default")
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const existing = await exec(
        `SELECT id FROM dashboard_widget_configs WHERE user_id = ? LIMIT 1`,
        [ctx.user.id]
      );
      if (existing.length > 0) {
        await exec(
          `UPDATE dashboard_widget_configs SET layout=?, widgets=?, theme=?, updated_at=? WHERE user_id=?`,
          [JSON.stringify(input.layout), JSON.stringify(input.widgets), input.theme, now, ctx.user.id]
        );
      } else {
        await exec(
          `INSERT INTO dashboard_widget_configs (user_id, layout, widgets, theme, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
          [ctx.user.id, JSON.stringify(input.layout), JSON.stringify(input.widgets), input.theme, now, now]
        );
      }
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // Get widget data for all enabled widgets
  getWidgetData: protectedProcedure.query(async ({ ctx }) => {
    const now = Date.now();
    const [
      breachRows, compRows, dsarRows, caseRows, orgRows,
      certRows, fineRows, alertRows, deadlineRows
    ] = await Promise.all([
      exec(`SELECT COUNT(*) as cnt FROM breach_incidents WHERE status != 'closed'`).catch(() => [{ cnt: 0 }]),
      exec(`SELECT AVG(score) as avg_score FROM compliance_scores WHERE created_at > ?`, [now - 30*24*3600*1000]).catch(() => [{ avg_score: 0 }]),
      exec(`SELECT COUNT(*) as cnt FROM dsar_requests WHERE status = 'pending'`).catch(() => [{ cnt: 0 }]),
      exec(`SELECT COUNT(*) as cnt FROM enforcement_cases WHERE status IN ('open','under_review')`).catch(() => [{ cnt: 0 }]),
      exec(`SELECT COUNT(*) as cnt FROM organizations`).catch(() => [{ cnt: 0 }]),
      exec(`SELECT COUNT(*) as cnt FROM dpco_certifications WHERE status = 'active'`).catch(() => [{ cnt: 0 }]),
      exec(`SELECT SUM(amount) as total FROM penalties WHERE status = 'paid'`).catch(() => [{ total: 0 }]),
      exec(`SELECT COUNT(*) as cnt FROM cross_sector_alerts WHERE status = 'active'`).catch(() => [{ cnt: 0 }]),
      exec(`SELECT COUNT(*) as cnt FROM breach_incidents WHERE status = 'open' AND created_at > ?`, [now - 72*3600*1000]).catch(() => [{ cnt: 0 }])
    ]);

    // Sector breakdown
    const sectorRows = await exec(
      `SELECT sector, COUNT(*) as cnt FROM organizations GROUP BY sector ORDER BY cnt DESC LIMIT 8`
    ).catch(() => []);

    // Recent alerts
    const recentAlerts = await exec(
      `SELECT id, title, severity, created_at FROM cross_sector_alerts ORDER BY created_at DESC LIMIT 5`
    ).catch(() => []);

    return {
      breach_count: Number((breachRows[0] as any)?.cnt ?? 0),
      compliance_score: Math.round(Number((compRows[0] as any)?.avg_score ?? 78)),
      pending_dsar: Number((dsarRows[0] as any)?.cnt ?? 0),
      active_cases: Number((caseRows[0] as any)?.cnt ?? 0),
      org_count: Number((orgRows[0] as any)?.cnt ?? 0),
      cert_status: Number((certRows[0] as any)?.cnt ?? 0),
      fine_total: Number((fineRows[0] as any)?.total ?? 0),
      recent_alerts: Number((alertRows[0] as any)?.cnt ?? 0),
      deadline_countdown: Number((deadlineRows[0] as any)?.cnt ?? 0),
      sector_breakdown: sectorRows.map((r: any) => ({ sector: r.sector, count: Number(r.cnt) })),
      recent_alert_list: recentAlerts.map((r: any) => ({
        id: r.id, title: r.title, severity: r.severity, createdAt: Number(r.created_at)
      })),
      nip_volume: Number((await exec(
        `SELECT COALESCE(SUM(transaction_count), 0) AS total FROM nip_transactions WHERE created_at > NOW() - INTERVAL '24 hours'`,
        []
      ).then((r: any[]) => r[0]?.total ?? 0).catch(() => 0))),
      risk_heatmap: (await exec(
        `SELECT sector, COALESCE(AVG(compliance_score), 75)::int AS score FROM organizations WHERE sector IS NOT NULL GROUP BY sector ORDER BY sector`,
        []
      ).catch(() => [])).map((r: any) => ({ sector: r.sector, score: Number(r.score) }))
    };
  })
});

// ── Chat Support Router ───────────────────────────────────────────────────────
export const chatSupportRouter = router({
  // Get or create active session
  getOrCreateSession: protectedProcedure
    .input(z.object({
      subject: z.string().optional(),
      category: z.enum(["technical","compliance","billing","general","urgent"]).default("general")
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      // Check for existing active session
      const existing = await exec(
        `SELECT * FROM support_chat_sessions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [ctx.user.id]
      );
      if (existing.length > 0) {
        const s = existing[0] as any;
        emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { sessionId: s.id, sessionToken: s.session_token, ticketNumber: s.ticket_number, isNew: false };
      }
      // Create new session
      const token = `sess-${ctx.user.id}-${now}-${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('')}`;
      const ticketNum = `TKT-${new Date().getFullYear()}-${String(Number(crypto.getRandomValues(new Uint32Array(1))[0]) % 99999 + 1).padStart(5,'0')}`;
      const result = await exec(
        `INSERT INTO support_chat_sessions (user_id, session_token, status, subject, category, ticket_number, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        [ctx.user.id, token, 'active', input.subject ?? 'Support Request', input.category, ticketNum, now, now]
      );
      const sessionId = (result as any).insertId;

      // Add welcome message
      await exec(
        `INSERT INTO support_chat_messages (session_id, role, content, created_at) VALUES (?,?,?,?)`,
        [sessionId, 'assistant', `Welcome to NDSEP Support! I am your AI compliance assistant. I can help you with:\n\n• **NDPA compliance** — breach notifications, consent management, DSAR requests\n• **DPCO certification** — application process, renewal, requirements\n• **CBN/NCC/NHIA regulations** — sector-specific guidance\n• **Platform navigation** — finding features, submitting reports\n\nYour ticket number is **${ticketNum}**. How can I assist you today?`, now]
      );

      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { sessionId, sessionToken: token, ticketNumber: ticketNum, isNew: true };
    }),

  // Get messages for a session
  getMessages: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verify session belongs to user
      const session = await exec(
        `SELECT * FROM support_chat_sessions WHERE id = ? AND user_id = ?`,
        [input.sessionId, ctx.user.id]
      );
      if (session.length === 0) throw new Error("Session not found");

      const messages = await exec(
        `SELECT id, role, content, metadata, created_at FROM support_chat_messages WHERE session_id = ? ORDER BY created_at ASC`,
        [input.sessionId]
      );
      return {
        session: session[0],
        messages: messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          metadata: m.metadata ? JSON.parse(m.metadata) : null,
          createdAt: Number(m.created_at)
        }))
      };
    }),

  // Send a message and get AI response
  sendMessage: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      content: z.string().min(1).max(2000)
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();

      // Verify session
      const session = await exec(
        `SELECT * FROM support_chat_sessions WHERE id = ? AND user_id = ? AND status = 'active'`,
        [input.sessionId, ctx.user.id]
      );
      if (session.length === 0) throw new Error("Session not found or closed");

      // Save user message
      await exec(
        `INSERT INTO support_chat_messages (session_id, role, content, created_at) VALUES (?,?,?,?)`,
        [input.sessionId, 'user', input.content, now]
      );

      // Get conversation history for context
      const history = await exec(
        `SELECT role, content FROM support_chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 20`,
        [input.sessionId]
      );

      // Build messages for LLM
      const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: MessageContent }> = [
        {
          role: "system",
          content: `You are NDSEP Support AI, an expert compliance assistant for Nigeria's National Data Sovereignty Enforcement Platform. You have deep knowledge of:
- Nigeria Data Protection Act (NDPA) 2023 and its provisions
- NDPC (National Data Protection Commission) regulations
- CBN (Central Bank of Nigeria) cybersecurity and data protection frameworks
- NCC (Nigerian Communications Commission) data protection regulations
- NHIA (National Health Insurance Authority) health data regulations
- NERC (Nigerian Electricity Regulatory Commission) data requirements
- NAICOM (National Insurance Commission) data governance
- DPCO (Data Protection Compliance Organisation) certification process
- DSAR (Data Subject Access Request) procedures
- Breach notification requirements (72-hour rule under Article 40)
- Penalty calculations under Section 48 (2% of annual gross revenue or ₦10 million)

Always be helpful, accurate, and cite specific sections of Nigerian law when relevant. If a user needs urgent help with a breach notification, escalate immediately. Keep responses concise and actionable.`
        },
        ...history.map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: String(m.content)
        }))
      ];

      // Get AI response
      let aiContent = "I apologize, I am temporarily unable to process your request. Please try again or escalate to a human agent.";
      let suggestedActions: string[] = [];

      try {
        const response = await invokeLLM({ messages: llmMessages });
        const rawContent = response.choices?.[0]?.message?.content;
        aiContent = typeof rawContent === 'string' ? rawContent : (Array.isArray(rawContent) ? rawContent.map((c: any) => c.text ?? '').join('') : aiContent);

        // Detect suggested actions based on content
        if (aiContent.toLowerCase().includes("breach") || aiContent.toLowerCase().includes("article 40")) {
          suggestedActions.push("Go to Breach Incident Center");
          suggestedActions.push("Open Article 40 Tracker");
        }
        if (aiContent.toLowerCase().includes("dsar") || aiContent.toLowerCase().includes("data subject")) {
          suggestedActions.push("Open DSAR Portal");
        }
        if (aiContent.toLowerCase().includes("certificate") || aiContent.toLowerCase().includes("dpco")) {
          suggestedActions.push("View DPCO Certification");
        }
        if (aiContent.toLowerCase().includes("penalty") || aiContent.toLowerCase().includes("fine")) {
          suggestedActions.push("Open Penalty Calculator");
        }
      } catch (e) {
        // Fallback to rule-based responses
        const q = input.content.toLowerCase();
        if (q.includes("breach") || q.includes("incident")) {
          aiContent = "For data breach incidents, you must notify the NDPC within **72 hours** under NDPA Article 40. Navigate to **Breach Incident Center** to log the incident, then use the **Article 40 Tracker** to submit your notification. The notification must include: nature of the breach, categories of data affected, approximate number of data subjects, likely consequences, and measures taken.";
          suggestedActions = ["Go to Breach Incident Center", "Open Article 40 Tracker"];
        } else if (q.includes("dsar") || q.includes("data subject")) {
          aiContent = "Data Subject Access Requests must be responded to within **30 days** under NDPA Section 35. Navigate to the **DSAR Portal** to manage requests. You can extend by 2 months for complex requests, but must notify the data subject within the first 30 days.";
          suggestedActions = ["Open DSAR Portal"];
        } else if (q.includes("penalty") || q.includes("fine")) {
          aiContent = "Under NDPA Section 48, penalties for data protection violations are the higher of: **2% of annual gross revenue** or **₦10 million** for serious violations. Use the **Penalty Calculator** to estimate potential fines based on your organisation's revenue and violation type.";
          suggestedActions = ["Open Penalty Calculator"];
        } else if (q.includes("certificate") || q.includes("dpco")) {
          aiContent = "DPCO (Data Protection Compliance Organisation) certification requires: a minimum compliance score of 85%, a registered DPO, an approved ROPA, and payment of certification fees. Visit the **DPCO Certification** page to start your application.";
          suggestedActions = ["View DPCO Certification"];
        } else {
          aiContent = "Thank you for your question. I am here to help with NDPA compliance, breach notifications, DSAR management, DPCO certification, and platform navigation. Could you provide more details about what you need help with?";
        }
      }

      // Save AI response
      const metadata = suggestedActions.length > 0 ? JSON.stringify({ suggestedActions }) : null;
      const insertResult = await exec(
        `INSERT INTO support_chat_messages (session_id, role, content, metadata, created_at) VALUES (?,?,?,?,?)`,
        [input.sessionId, 'assistant', aiContent, metadata, Date.now()]
      );

      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        messageId: (insertResult as any).insertId,
        content: aiContent,
        suggestedActions
      };
    }),

  // Escalate to human agent
  escalate: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      reason: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      await exec(
        `UPDATE support_chat_sessions SET status='escalated', updated_at=? WHERE id=? AND user_id=?`,
        [now, input.sessionId, ctx.user.id]
      );
      await exec(
        `INSERT INTO support_chat_messages (session_id, role, content, created_at) VALUES (?,?,?,?)`,
        [input.sessionId, 'system', `This session has been escalated to a human agent. ${input.reason ? `Reason: ${input.reason}. ` : ''}A support agent will respond within 2 business hours. Your ticket number is preserved for reference.`, now]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, message: "Session escalated to human agent" };
    }),

  // Close session
  closeSession: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      await exec(
        `UPDATE support_chat_sessions SET status='resolved', resolved_at=?, updated_at=? WHERE id=? AND user_id=?`,
        [now, now, input.sessionId, ctx.user.id]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // Get all sessions for user
  getSessions: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await exec(
      `SELECT id, session_token, status, subject, category, priority, ticket_number, created_at, updated_at FROM support_chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
      [ctx.user.id]
    );
    return sessions.map((s: any) => ({
      id: s.id,
      sessionToken: s.session_token,
      status: s.status,
      subject: s.subject,
      category: s.category,
      priority: s.priority,
      ticketNumber: s.ticket_number,
      createdAt: Number(s.created_at),
      updatedAt: Number(s.updated_at)
    }));
  })
});

// ── Tutorial Router ───────────────────────────────────────────────────────────
export const tutorialRouter = router({
  // Get progress for all tutorials
  getProgress: protectedProcedure.query(async ({ ctx }) => {
    const rows = await exec(
      `SELECT tutorial_id, step_id, completed, completed_at FROM tutorial_progress WHERE user_id = ?`,
      [ctx.user.id]
    );
    const progress: Record<string, Record<string, { completed: boolean; completedAt: number | null }>> = {};
    for (const r of rows as any[]) {
      if (!progress[r.tutorial_id]) progress[r.tutorial_id] = {};
      progress[r.tutorial_id][r.step_id] = {
        completed: Boolean(r.completed),
        completedAt: r.completed_at ? Number(r.completed_at) : null
      };
    }
    return progress;
  }),

  // Mark a step as complete
  completeStep: protectedProcedure
    .input(z.object({
      tutorialId: z.string(),
      stepId: z.string()
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      await exec(
        `INSERT INTO tutorial_progress (user_id, tutorial_id, step_id, completed, completed_at, created_at)
         VALUES (?,?,?,1,?,?)
         ON DUPLICATE KEY UPDATE completed=1, completed_at=?`,
        [ctx.user.id, input.tutorialId, input.stepId, now, now, now]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // Reset tutorial progress
  resetTutorial: protectedProcedure
    .input(z.object({ tutorialId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await exec(
        `UPDATE tutorial_progress SET completed=0, completed_at=NULL WHERE user_id=? AND tutorial_id=?`,
        [ctx.user.id, input.tutorialId]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // Track help article view
  trackArticleView: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await exec(
        `INSERT INTO help_article_views (user_id, article_id, viewed_at) VALUES (?,?,?)`,
        [ctx.user.id, input.articleId, Date.now()]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_GAP_IDENTIFIED, { action: "compliance_gap_analysis", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // Get most viewed articles
  getPopularArticles: protectedProcedure.query(async () => {
    const rows = await exec(
      `SELECT article_id, COUNT(*) as views FROM help_article_views GROUP BY article_id ORDER BY views DESC LIMIT 10`
    );
    return rows.map((r: any) => ({ articleId: r.article_id, views: Number(r.views) }));
  })
});
