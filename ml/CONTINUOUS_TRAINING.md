# Continuous Training — Scheduling & Operations

`ml/training/continuous.py` decides **whether** to fine-tune and then runs
the existing `ml/training/fine_tune.py` path (Postgres-first data, drift
check, versioned weights, registry entry). A cycle fine-tunes a model when
**any** of the following holds:

- `--force` was passed,
- **drift detected** on a fresh batch (PSI > 0.25 or KS p < 0.01 with
  effect > 0.1 against the train-time feature stats — `ml/monitoring/drift.py`),
- **weights stale**: canonical weights older than `--max-staleness-hours`
  (default **72h**, matching the platform's model-refresh cadence).

Every cycle appends an auditable run record to
`ml/lakehouse/training_runs/` (jsonl + parquet snapshot) and failures emit
an alert (`ml/lakehouse/alerts/` + Postgres `compliance_drift_alerts` when
`DATABASE_URL` is reachable). Exit code is non-zero on any model failure.

## Option A — plain cron (recommended default)

Daily at 02:00 WAT, single cycle, logs to file:

```cron
0 2 * * *  cd /app && python -m ml.training.continuous --once --model all \
           >> /var/log/ndsep/continuous_training.log 2>&1
```

A second, drift-only check can run more cheaply every 6 hours (it skips
training when there is no drift and weights are fresh):

```cron
0 */6 * * *  cd /app && python -m ml.training.continuous --once --model all \
           >> /var/log/ndsep/continuous_training.log 2>&1
```

## Option B — long-running scheduler loop

Inside the Python workers container (or a dedicated service):

```bash
python -m ml.training.continuous --model all --interval-hours 24
```

## Option C — Temporal schedule (platform-native)

The platform already runs a Temporal worker (`workers/temporal/worker.ts`,
task queues `ndsep-accreditation` / `ndsep-breach`, service
`temporal-worker` in docker-compose-workers-addition.yml). Add an ML
retraining workflow on a new task queue `ndsep-ml-training`:

1. **Workflow** (`workers/temporal/workflows/mlRetraining.ts`) — a thin
   workflow whose single activity shells out to the Python orchestrator.
2. **Activity** (`workers/temporal/activities/mlRetraining.ts`):

```ts
import { execFile } from "child_process";
import { promisify } from "util";
const execFileP = promisify(execFile);

export async function runContinuousTrainingCycle(): Promise<string> {
  const { stdout } = await execFileP(
    "python",
    ["-m", "ml.training.continuous", "--once", "--model", "all"],
    { cwd: "/app", timeout: 1000 * 60 * 60 }, // 1h activity timeout
  );
  return stdout;
}
```

3. **Schedule** (register once, e.g. from an ops script or `temporal` CLI):

```bash
temporal schedule create \
  --schedule-id ndsep-ml-continuous-training \
  --cron "0 2 * * *" \
  --workflow-type mlRetrainingWorkflow \
  --task-queue ndsep-ml-training \
  --workflow-id ndsep-ml-continuous-training-run
```

or via the TypeScript client:

```ts
import { Client, ScheduleOverlapPolicy } from "@temporalio/client";

const client = new Client({ /* same connection as workers/temporal/worker.ts */ });
await client.schedule.create({
  scheduleId: "ndsep-ml-continuous-training",
  spec: { cronExpressions: ["0 2 * * *"] },          // daily 02:00
  action: {
    type: "startWorkflow",
    workflowType: "mlRetrainingWorkflow",
    taskQueue: "ndsep-ml-training",
  },
  policies: { overlap: ScheduleOverlapPolicy.SKIP },  // never stack cycles
});
```

`ScheduleOverlapPolicy.SKIP` matters: a fine-tune cycle on CPU can take
tens of minutes; overlapping cycles would contend on the weights dir.

## Cadence mapping (platform ↔ ML stack)

| Platform cadence | ML-stack meaning |
|---|---|
| **Daily** (compliance rescoring, `compliance-rescorer` worker) | Daily `--once` cycle (cron/Temporal above); cheap drift check, trains only when needed. |
| **72h** (model refresh / audit window) | `--max-staleness-hours 72` default: weights older than 72h are fine-tuned even without drift, so no model in production is ever more than 3 days stale. |
| **72h** NDPR breach-notification window | Unrelated to training, but the same alerting channel (`compliance_drift_alerts`) carries training-failure alerts into the platform's existing incident flow. |

## Promotion policy

Continuous training **never** overwrites the canonical
`ml/weights/<model>_net.pt`. It produces versioned candidates
(`<model>_net_<version>.pt`). Promotion to production traffic goes through
the A/B harness (`ml/ab_testing.py`): create an experiment with the new
version as challenger, route a traffic slice, and `promote` only when the
challenger wins on logged outcomes (or the proxy holdout) with the minimum
sample size. See `ml/README.md` § A/B testing.
