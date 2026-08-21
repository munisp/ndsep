/**
 * NDSEP ML Training Pipeline Manager
 * =====================================
 * Orchestrates ML model training, evaluation, and deployment for
 * breach prediction, risk scoring, and anomaly detection.
 *
 * Models:
 *   breach_prediction     — XGBoost: predicts breach probability per org
 *   risk_scoring          — Random Forest: compliance risk classification
 *   anomaly_detection     — Isolation Forest: network/behavioral anomalies
 *   sentiment_analysis    — NLP: citizen complaint sentiment scoring
 *   sla_forecasting       — Time series: SLA breach probability forecast
 *
 * Pipeline Steps:
 *   1. Extract features from PostgreSQL
 *   2. Train model (Python worker)
 *   3. Evaluate (precision, recall, F1, AUC)
 *   4. Store model artifact
 *   5. Deploy to prediction endpoint
 *
 * Environment:
 *   ML_WORKER_URL   — ML prediction worker URL (default: http://localhost:8085)
 *   ML_PIPELINE_DIR — Directory for model artifacts
 */

import { logger } from "./logger";
import { captureError } from "./errorMonitoring";
import { publishEvent } from "./eventBus";

const ML_WORKER_URL = process.env.ML_WORKER_URL ?? "http://localhost:8085";

interface ModelDefinition {
  name: string;
  description: string;
  algorithm: string;
  features: string[];
  targetColumn: string;
  sourceTable: string;
  minTrainingRows: number;
  retrainIntervalHours: number;
}

interface TrainingResult {
  modelName: string;
  status: "success" | "failed" | "insufficient_data";
  metrics?: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1Score?: number;
    auc?: number;
    mse?: number;
  };
  trainingRows: number;
  trainingTimeMs: number;
  modelVersion: string;
  error?: string;
}

interface PipelineStatus {
  models: Array<{
    name: string;
    lastTrained?: string;
    lastResult?: TrainingResult;
    nextTraining?: string;
    status: "ready" | "training" | "stale" | "untrained";
  }>;
  workerConnected: boolean;
  totalTrainings: number;
  successfulTrainings: number;
}

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    name: "breach_prediction",
    description: "Predicts 30/90-day breach probability for each organization based on compliance history, sector risk, and incident patterns",
    algorithm: "XGBoost",
    features: ["compliance_score", "sector_risk", "breach_history_count", "days_since_last_audit", "employee_count", "data_volume_gb", "cross_border_transfers"],
    targetColumn: "had_breach_next_90d",
    sourceTable: "organizations JOIN breach_incidents",
    minTrainingRows: 50,
    retrainIntervalHours: 168, // weekly
  },
  {
    name: "risk_scoring",
    description: "Classifies organizations into risk tiers (low/medium/high/critical) based on multi-dimensional compliance factors",
    algorithm: "RandomForest",
    features: ["compliance_score", "dpa_status", "dpo_appointed", "privacy_notice", "breach_count_12m", "enforcement_count", "sector"],
    targetColumn: "risk_tier",
    sourceTable: "organizations",
    minTrainingRows: 30,
    retrainIntervalHours: 72, // every 3 days
  },
  {
    name: "anomaly_detection",
    description: "Detects anomalous network behavior, unusual access patterns, and potential data exfiltration events",
    algorithm: "IsolationForest",
    features: ["request_rate", "data_transfer_volume", "unique_ips", "off_hours_access", "failed_auth_count", "api_error_rate"],
    targetColumn: "is_anomaly",
    sourceTable: "security_alerts JOIN audit_logs",
    minTrainingRows: 100,
    retrainIntervalHours: 24, // daily
  },
  {
    name: "sentiment_analysis",
    description: "Scores citizen complaint and feedback sentiment for prioritizing regulatory responses",
    algorithm: "NLP-BERT",
    features: ["complaint_text", "category", "urgency_keywords"],
    targetColumn: "sentiment_score",
    sourceTable: "citizen_requests",
    minTrainingRows: 20,
    retrainIntervalHours: 336, // bi-weekly
  },
  {
    name: "sla_forecasting",
    description: "Forecasts SLA breach probability for active breach incidents based on response time patterns",
    algorithm: "TimeSeries-Prophet",
    features: ["hours_elapsed", "severity", "org_response_history", "assigned_staff_count", "similar_breach_resolution_time"],
    targetColumn: "will_breach_sla",
    sourceTable: "breach_incidents",
    minTrainingRows: 30,
    retrainIntervalHours: 48,
  },
];

const trainingHistory = new Map<string, TrainingResult>();
let totalTrainings = 0;
let successfulTrainings = 0;

async function checkWorkerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${ML_WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function trainModel(modelName: string): Promise<TrainingResult> {
  const def = MODEL_DEFINITIONS.find((m) => m.name === modelName);
  if (!def) {
    return {
      modelName,
      status: "failed",
      trainingRows: 0,
      trainingTimeMs: 0,
      modelVersion: "",
      error: `Unknown model: ${modelName}`,
    };
  }

  const start = Date.now();
  totalTrainings++;

  try {
    const res = await fetch(`${ML_WORKER_URL}/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_name: def.name,
        algorithm: def.algorithm,
        features: def.features,
        target: def.targetColumn,
        source_table: def.sourceTable,
        min_rows: def.minTrainingRows,
      }),
      signal: AbortSignal.timeout(300_000), // 5 min timeout for training
    });

    const data = (await res.json()) as Record<string, unknown>;
    const result: TrainingResult = {
      modelName,
      status: res.ok ? "success" : "failed",
      metrics: data.metrics as TrainingResult["metrics"],
      trainingRows: Number(data.training_rows ?? 0),
      trainingTimeMs: Date.now() - start,
      modelVersion: String(data.model_version ?? `v${Date.now()}`),
      error: res.ok ? undefined : String(data.error ?? "Training failed"),
    };

    if (result.status === "success") {
      successfulTrainings++;
      await publishEvent("compliance.audit_completed", modelName, "ml_model", {
        algorithm: def.algorithm,
        metrics: result.metrics,
        rows: result.trainingRows,
      });
    }

    trainingHistory.set(modelName, result);
    logger.info({ modelName, status: result.status, rows: result.trainingRows, ms: result.trainingTimeMs }, "[MLPipeline] Training complete");
    return result;
  } catch (err) {
    const result: TrainingResult = {
      modelName,
      status: "failed",
      trainingRows: 0,
      trainingTimeMs: Date.now() - start,
      modelVersion: "",
      error: err instanceof Error ? err.message : String(err),
    };
    trainingHistory.set(modelName, result);
    captureError(err instanceof Error ? err : new Error(String(err)), "ml-pipeline");
    return result;
  }
}

export async function trainAllModels(): Promise<TrainingResult[]> {
  const results: TrainingResult[] = [];
  for (const def of MODEL_DEFINITIONS) {
    const result = await trainModel(def.name);
    results.push(result);
  }
  return results;
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const workerConnected = await checkWorkerHealth();

  const models = MODEL_DEFINITIONS.map((def) => {
    const lastResult = trainingHistory.get(def.name);
    let status: "ready" | "training" | "stale" | "untrained" = "untrained";
    if (lastResult?.status === "success") {
      const hoursSince = (Date.now() - lastResult.trainingTimeMs) / 3600_000;
      status = hoursSince > def.retrainIntervalHours ? "stale" : "ready";
    }

    return {
      name: def.name,
      lastTrained: lastResult ? new Date().toISOString() : undefined,
      lastResult,
      nextTraining: lastResult
        ? new Date(Date.now() + def.retrainIntervalHours * 3600_000).toISOString()
        : undefined,
      status,
    };
  });

  return {
    models,
    workerConnected,
    totalTrainings,
    successfulTrainings,
  };
}

export function getModelDefinitions() {
  return MODEL_DEFINITIONS.map((d) => ({
    name: d.name,
    description: d.description,
    algorithm: d.algorithm,
    features: d.features,
    minRows: d.minTrainingRows,
    retrainHours: d.retrainIntervalHours,
  }));
}
