/** Staging-only mock; bind only to localhost or an isolated test namespace. */
import express from "express";

type Mode = "healthy" | "network_partition" | "kms_revoked" | "dead_letter_spike" | "queue_deadlock";
let mode: Mode = "healthy";
const app = express();
app.use(express.json());

app.post("/__drill/mode", (req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).end();
  const next = req.body?.mode as Mode;
  if (!(["healthy", "network_partition", "kms_revoked", "dead_letter_spike", "queue_deadlock"] as string[]).includes(next)) return res.status(400).json({ error: "invalid_mode" });
  mode = next;
  return res.json({ mode });
});

app.post("/recovery/rewrap", (_req, res) => {
  if (mode === "network_partition") return res.status(503).json({ code: "NETWORK_UNAVAILABLE" });
  if (mode === "kms_revoked") return res.status(403).json({ code: "KMS_ACCESS_DENIED" });
  return res.json({ deviceWrappedEnvelope: "test-only-envelope", keyVersion: 2 });
});

app.post("/onboarding/replay", (_req, res) => {
  if (mode === "network_partition") return res.status(503).json({ code: "NETWORK_UNAVAILABLE" });
  if (mode === "dead_letter_spike") return res.status(400).json({ code: "REPLAY_VALIDATION_FAILED" });
  if (mode === "queue_deadlock") return res.status(409).json({ code: "QUEUE_IN_FLIGHT_CONFLICT" });
  return res.status(201).json({ replayed: false, result: { id: "staging-test" } });
});

app.listen(Number(process.env.MOCK_REPLAY_PORT ?? 4010), "127.0.0.1");
