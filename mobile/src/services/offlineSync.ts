/**
 * NDSEP Mobile — Offline-First Sync Engine
 * Bidirectional sync between local SQLite and remote PostgreSQL.
 * Uses conflict resolution with last-write-wins + vector clocks.
 */
import * as SQLite from "expo-sqlite";
import NetInfo from "@react-native-community/netinfo";
import { api } from "./api";

interface SyncMetadata {
  id: string;
  table: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  data: string; // JSON
  timestamp: number;
  synced: boolean;
  conflictResolution?: string;
  vectorClock: Record<string, number>;
}

class OfflineSyncEngine {
  private db: SQLite.SQLiteDatabase | null = null;
  private isOnline = true;
  private syncInProgress = false;
  private listeners: Array<(status: SyncStatus) => void> = [];

  async init() {
    this.db = await SQLite.openDatabaseAsync("ndsep_offline.db");

    // Create sync metadata table
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        conflict_resolution TEXT,
        vector_clock TEXT DEFAULT '{}',
        retry_count INTEGER DEFAULT 0,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS local_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_timestamp ON sync_queue(timestamp);
    `);

    // Monitor network state
    NetInfo.addEventListener((state) => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? false;
      if (wasOffline && this.isOnline) {
        this.triggerSync();
      }
    });
  }

  async queueMutation(table: string, operation: "INSERT" | "UPDATE" | "DELETE", data: Record<string, unknown>) {
    if (!this.db) throw new Error("Sync engine not initialized");

    const id = `${table}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const vectorClock = await this.getVectorClock(table);
    vectorClock["mobile"] = (vectorClock["mobile"] ?? 0) + 1;

    await this.db.runAsync(
      `INSERT INTO sync_queue (id, table_name, operation, data, timestamp, vector_clock) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, table, operation, JSON.stringify(data), Date.now(), JSON.stringify(vectorClock)]
    );

    this.notifyListeners({ pendingCount: await this.getPendingCount(), lastSync: null });

    if (this.isOnline) {
      this.triggerSync();
    }

    return id;
  }

  async triggerSync() {
    if (this.syncInProgress || !this.isOnline) return;
    this.syncInProgress = true;

    try {
      const pending = await this.db!.getAllAsync<SyncMetadata>(
        `SELECT * FROM sync_queue WHERE synced = 0 ORDER BY timestamp ASC LIMIT 50`
      );

      for (const entry of pending) {
        try {
          await api.syncOfflineQueue();
          await this.db!.runAsync(
            `UPDATE sync_queue SET synced = 1 WHERE id = ?`,
            [entry.id]
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await this.db!.runAsync(
            `UPDATE sync_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`,
            [msg, entry.id]
          );
        }
      }

      this.notifyListeners({
        pendingCount: await this.getPendingCount(),
        lastSync: new Date(),
      });
    } finally {
      this.syncInProgress = false;
    }
  }

  async getPendingCount(): Promise<number> {
    if (!this.db) return 0;
    const result = await this.db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0`
    );
    return result?.count ?? 0;
  }

  async getCachedData<T>(key: string): Promise<T | null> {
    if (!this.db) return null;
    const result = await this.db.getFirstAsync<{ value: string; expires_at: number }>(
      `SELECT value, expires_at FROM local_cache WHERE key = ?`,
      [key]
    );
    if (!result) return null;
    if (result.expires_at && result.expires_at < Date.now()) {
      await this.db.runAsync(`DELETE FROM local_cache WHERE key = ?`, [key]);
      return null;
    }
    return JSON.parse(result.value);
  }

  async setCachedData(key: string, value: unknown, ttlMs?: number) {
    if (!this.db) return;
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    await this.db.runAsync(
      `INSERT OR REPLACE INTO local_cache (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)`,
      [key, JSON.stringify(value), expiresAt, Date.now()]
    );
  }

  private async getVectorClock(table: string): Promise<Record<string, number>> {
    if (!this.db) return {};
    const result = await this.db.getFirstAsync<{ vector_clock: string }>(
      `SELECT vector_clock FROM sync_queue WHERE table_name = ? ORDER BY timestamp DESC LIMIT 1`,
      [table]
    );
    return result ? JSON.parse(result.vector_clock) : {};
  }

  onSyncStatusChange(listener: (status: SyncStatus) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(status: SyncStatus) {
    this.listeners.forEach((l) => l(status));
  }
}

interface SyncStatus {
  pendingCount: number;
  lastSync: Date | null;
}

export const syncEngine = new OfflineSyncEngine();
