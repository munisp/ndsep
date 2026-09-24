#!/usr/bin/env node
/**
 * NDSEP Compliance Calendar Email Reminder Worker
 * Runs daily (via cron or systemd timer) and sends email notifications
 * for compliance calendar events whose due_date is within reminder_days.
 *
 * Usage:
 *   node scripts/calendar_reminder_worker.mjs
 *   # Or via cron: 0 7 * * * /usr/bin/node /app/scripts/calendar_reminder_worker.mjs
 */

// Use pnpm-managed pg module (absolute path from project root)
import pg from './node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db';
const NOTIFY_URL = process.env.BUILT_IN_FORGE_API_URL || 'https://api.manus.im';
const NOTIFY_KEY = process.env.BUILT_IN_FORGE_API_KEY || '';
const APP_ID = process.env.VITE_APP_ID || 'ndsep';
const OWNER_OPEN_ID = process.env.OWNER_OPEN_ID || '';

async function sendOwnerNotification(title, content) {
  if (!NOTIFY_KEY || !OWNER_OPEN_ID) {
    console.log(`[Reminder] Would notify owner: ${title}`);
    return true;
  }
  try {
    const res = await fetch(`${NOTIFY_URL}/notification/v1/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NOTIFY_KEY}`,
      },
      body: JSON.stringify({
        app_id: APP_ID,
        open_id: OWNER_OPEN_ID,
        title,
        content,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[Reminder] Notification failed:', err.message);
    return false;
  }
}

async function main() {
  console.log(`[Reminder] Starting calendar reminder worker at ${new Date().toISOString()}`);

  // Parse DATABASE_URL to extract host/port/db/user/password for reliable SSL handling
  let clientConfig;
  try {
    const url = new URL(DATABASE_URL);
    clientConfig = {
      host: url.hostname,
      port: parseInt(url.port || '5432'),
      database: url.pathname.replace('/', ''),
      user: url.username,
      password: url.password,
      ssl: url.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: false } : false,
    };
  } catch {
    clientConfig = { connectionString: DATABASE_URL, ssl: false };
  }
  const client = new pg.Client(clientConfig);
  try {
    await client.connect();

    const result = await client.query(`
      SELECT id, title, event_type, due_date, priority, description, assigned_to, reminder_days
      FROM compliance_calendar_events
      WHERE status = 'pending'
        AND due_date >= CURRENT_DATE
        AND due_date <= CURRENT_DATE + (reminder_days || ' days')::INTERVAL
        AND (last_reminder_sent IS NULL OR last_reminder_sent < CURRENT_DATE - INTERVAL '1 day')
      ORDER BY due_date ASC
    `);

    const events = result.rows;
    console.log(`[Reminder] Found ${events.length} events needing reminders`);

    for (const evt of events) {
      const daysUntilDue = Math.ceil((new Date(evt.due_date) - new Date()) / (1000 * 60 * 60 * 24));
      const title = `⚠️ Compliance Deadline Reminder: ${evt.title}`;
      const content = [
        `Event: ${evt.title}`,
        `Type: ${evt.event_type}`,
        `Due Date: ${new Date(evt.due_date).toLocaleDateString('en-NG', { dateStyle: 'full' })}`,
        `Days Until Due: ${daysUntilDue}`,
        `Priority: ${evt.priority?.toUpperCase()}`,
        evt.assigned_to ? `Assigned To: ${evt.assigned_to}` : '',
        evt.description ? `\nDetails: ${evt.description}` : '',
        `\nPlease log into the NDSEP platform to review and action this compliance event.`,
      ].filter(Boolean).join('\n');

      const sent = await sendOwnerNotification(title, content);
      if (sent) {
        await client.query(
          `UPDATE compliance_calendar_events SET last_reminder_sent = CURRENT_DATE, updated_at = NOW() WHERE id = $1`,
          [evt.id]
        );
        console.log(`[Reminder] Sent reminder for event #${evt.id}: ${evt.title}`);
      }
    }

    await client.end();
    console.log(`[Reminder] Worker completed. Processed ${events.length} reminders.`);
  } catch (err) {
    console.error('[Reminder] Error:', err.message);
    try { await client.end(); } catch (_) {}
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Reminder] Fatal error:', err);
  process.exit(1);
});
