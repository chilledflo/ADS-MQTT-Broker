import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface VariableHistoryEntry {
  id?: number;
  variableId: string;
  variableName: string;
  value: any;
  timestamp: number;
  quality?: 'GOOD' | 'BAD' | 'UNCERTAIN';
}

export interface SystemMetric {
  id?: number;
  timestamp: number;
  metricType: 'cpu' | 'memory' | 'mqtt_clients' | 'mqtt_messages' | 'ads_errors' | 'api_requests';
  value: number;
  metadata?: string;
}

export interface VariableStatistics {
  variableId: string;
  variableName: string;
  count: number;
  minValue: number;
  maxValue: number;
  avgValue: number;
  lastValue: any;
  lastUpdate: number;
  firstSeen: number;
}

export class PersistenceLayer {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'broker.db');

    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initializeDatabase();
    console.log(`[Persistence] Database initialized at ${this.dbPath}`);
  }

  private initializeDatabase(): void {
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS variable_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variableId TEXT NOT NULL,
        variableName TEXT NOT NULL,
        value TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        quality TEXT DEFAULT 'GOOD'
      );

      CREATE INDEX IF NOT EXISTS idx_variable_timestamp ON variable_history (variableId, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON variable_history (timestamp DESC);

      CREATE TABLE IF NOT EXISTS system_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        metricType TEXT NOT NULL,
        value REAL NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_metric_timestamp ON system_metrics (metricType, timestamp DESC);

      CREATE TABLE IF NOT EXISTS variable_metadata (
        variableId TEXT PRIMARY KEY,
        variableName TEXT NOT NULL,
        path TEXT NOT NULL,
        type TEXT NOT NULL,
        pollInterval INTEGER NOT NULL,
        mqttTopic TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        createdBy TEXT,
        lastUpdate INTEGER
      );

      CREATE TABLE IF NOT EXISTS audit_logs_persistent (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        variableId TEXT,
        variableName TEXT,
        userId TEXT,
        userIp TEXT,
        userAgent TEXT,
        oldValue TEXT,
        newValue TEXT,
        details TEXT,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs_persistent (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_variable ON audit_logs_persistent (variableId, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs_persistent (userId, timestamp DESC);

      CREATE TABLE IF NOT EXISTS ads_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        targetIp TEXT NOT NULL,
        targetPort INTEGER NOT NULL,
        sourcePort INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        autoDiscovery INTEGER DEFAULT 1,
        discoveryInterval INTEGER DEFAULT 30000,
        autoAddVariables INTEGER DEFAULT 1,
        defaultPollInterval INTEGER DEFAULT 1000,
        symbolFilter TEXT,
        createdAt INTEGER NOT NULL,
        lastConnected INTEGER,
        lastError TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_connection_enabled ON ads_connections (enabled);
    `);
  }

  // ===== Variable History =====

  saveVariableValue(entry: VariableHistoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO variable_history (variableId, variableName, value, timestamp, quality)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.variableId,
      entry.variableName,
      JSON.stringify(entry.value),
      entry.timestamp,
      entry.quality || 'GOOD'
    );
  }

  getVariableHistory(
    variableId: string,
    startTime?: number,
    endTime?: number,
    limit: number = 1000
  ): VariableHistoryEntry[] {
    let query = `
      SELECT id, variableId, variableName, value, timestamp, quality
      FROM variable_history
      WHERE variableId = ?
    `;

    const params: any[] = [variableId];

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }

    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      variableId: row.variableId,
      variableName: row.variableName,
      value: JSON.parse(row.value),
      timestamp: row.timestamp,
      quality: row.quality
    }));
  }

  getVariableHistoryByTimeRange(
    startTime: number,
    endTime: number,
    limit: number = 1000
  ): VariableHistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT id, variableId, variableName, value, timestamp, quality
      FROM variable_history
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(startTime, endTime, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      variableId: row.variableId,
      variableName: row.variableName,
      value: JSON.parse(row.value),
      timestamp: row.timestamp,
      quality: row.quality
    }));
  }

  // ===== Variable Statistics =====

  getVariableStatistics(variableId: string): VariableStatistics | null {
    const stmt = this.db.prepare(`
      SELECT
        variableId,
        variableName,
        COUNT(*) as count,
        MIN(CAST(value AS REAL)) as minValue,
        MAX(CAST(value AS REAL)) as maxValue,
        AVG(CAST(value AS REAL)) as avgValue,
        MAX(timestamp) as lastUpdate,
        MIN(timestamp) as firstSeen
      FROM variable_history
      WHERE variableId = ?
      GROUP BY variableId
    `);

    const row = stmt.get(variableId) as any;

    if (!row) return null;

    // Get last value separately
    const lastValueStmt = this.db.prepare(`
      SELECT value FROM variable_history
      WHERE variableId = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    const lastValueRow = lastValueStmt.get(variableId) as any;

    return {
      variableId: row.variableId,
      variableName: row.variableName,
      count: row.count,
      minValue: row.minValue,
      maxValue: row.maxValue,
      avgValue: row.avgValue,
      lastValue: lastValueRow ? JSON.parse(lastValueRow.value) : null,
      lastUpdate: row.lastUpdate,
      firstSeen: row.firstSeen
    };
  }

  getAllVariableStatistics(): VariableStatistics[] {
    const stmt = this.db.prepare(`
      SELECT
        variableId,
        variableName,
        COUNT(*) as count,
        MIN(CAST(value AS REAL)) as minValue,
        MAX(CAST(value AS REAL)) as maxValue,
        AVG(CAST(value AS REAL)) as avgValue,
        MAX(timestamp) as lastUpdate,
        MIN(timestamp) as firstSeen
      FROM variable_history
      GROUP BY variableId
      ORDER BY variableName
    `);

    const rows = stmt.all() as any[];

    return rows.map(row => {
      // Get last value for each variable
      const lastValueStmt = this.db.prepare(`
        SELECT value FROM variable_history
        WHERE variableId = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `);

      const lastValueRow = lastValueStmt.get(row.variableId) as any;

      return {
        variableId: row.variableId,
        variableName: row.variableName,
        count: row.count,
        minValue: row.minValue,
        maxValue: row.maxValue,
        avgValue: row.avgValue,
        lastValue: lastValueRow ? JSON.parse(lastValueRow.value) : null,
        lastUpdate: row.lastUpdate,
        firstSeen: row.firstSeen
      };
    });
  }

  // ===== System Metrics =====

  saveSystemMetric(metric: SystemMetric): void {
    const stmt = this.db.prepare(`
      INSERT INTO system_metrics (timestamp, metricType, value, metadata)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      metric.timestamp,
      metric.metricType,
      metric.value,
      metric.metadata || null
    );
  }

  getSystemMetrics(
    metricType: string,
    startTime?: number,
    endTime?: number,
    limit: number = 1000
  ): SystemMetric[] {
    let query = `
      SELECT id, timestamp, metricType, value, metadata
      FROM system_metrics
      WHERE metricType = ?
    `;

    const params: any[] = [metricType];

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }

    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      metricType: row.metricType,
      value: row.value,
      metadata: row.metadata
    }));
  }

  // ===== Audit Logs Persistence =====

  saveAuditLog(log: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs_persistent
      (id, timestamp, action, variableId, variableName, userId, userIp, userAgent, oldValue, newValue, details, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      log.id,
      log.timestamp instanceof Date ? log.timestamp.getTime() : log.timestamp,
      log.action,
      log.variableId || null,
      log.variableName || null,
      log.userId || null,
      log.userIp || null,
      log.userAgent || null,
      log.oldValue ? JSON.stringify(log.oldValue) : null,
      log.newValue ? JSON.stringify(log.newValue) : null,
      log.details,
      log.status
    );
  }

  getAuditLogs(limit: number = 100): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs_persistent
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(limit) as any[];
  }

  // ===== Cleanup & Maintenance =====

  cleanupOldData(retentionDays: number = 30): void {
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    // Clean variable history
    const historyStmt = this.db.prepare('DELETE FROM variable_history WHERE timestamp < ?');
    const historyDeleted = historyStmt.run(cutoff);

    // Clean system metrics
    const metricsStmt = this.db.prepare('DELETE FROM system_metrics WHERE timestamp < ?');
    const metricsDeleted = metricsStmt.run(cutoff);

    // Clean audit logs
    const auditStmt = this.db.prepare('DELETE FROM audit_logs_persistent WHERE timestamp < ?');
    const auditDeleted = auditStmt.run(cutoff);

    console.log(`[Persistence] Cleanup complete: ${historyDeleted.changes} history, ${metricsDeleted.changes} metrics, ${auditDeleted.changes} audit logs deleted`);

    // Vacuum to reclaim space
    this.db.exec('VACUUM');
  }

  getDatabaseStats(): any {
    const tables = ['variable_history', 'system_metrics', 'variable_metadata', 'audit_logs_persistent', 'ads_connections'];
    const stats: any = {};

    tables.forEach(table => {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
      const result = stmt.get() as any;
      stats[table] = result.count;
    });

    // Get database file size
    if (fs.existsSync(this.dbPath)) {
      const dbStats = fs.statSync(this.dbPath);
      stats.dbSizeBytes = dbStats.size;
      stats.dbSizeMB = (dbStats.size / 1024 / 1024).toFixed(2);
    }

    return stats;
  }

  /**
   * Speichert eine ADS-Verbindungskonfiguration
   */
  saveAdsConnection(config: any): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ads_connections (
        id, name, host, port, targetIp, targetPort, sourcePort, 
        enabled, description, autoDiscovery, discoveryInterval, 
        autoAddVariables, defaultPollInterval, symbolFilter, 
        createdAt, lastConnected, lastError
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      config.id,
      config.name,
      config.host,
      config.port,
      config.targetIp,
      config.targetPort,
      config.sourcePort,
      config.enabled ? 1 : 0,
      config.description || null,
      config.symbolDiscovery?.autoDiscovery ? 1 : 0,
      config.symbolDiscovery?.discoveryInterval || 30000,
      config.symbolDiscovery?.autoAddVariables ? 1 : 0,
      config.symbolDiscovery?.defaultPollInterval || 1000,
      config.symbolDiscovery?.symbolFilter?.source || null,
      Date.now(),
      config.lastConnected || null,
      config.lastError || null
    );
  }

  /**
   * Lädt alle gespeicherten ADS-Verbindungen
   */
  loadAdsConnections(): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM ads_connections WHERE enabled = 1 ORDER BY name
    `);
    
    const rows = stmt.all() as any[];
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      targetIp: row.targetIp,
      targetPort: row.targetPort,
      sourcePort: row.sourcePort,
      enabled: row.enabled === 1,
      description: row.description,
      symbolDiscovery: {
        autoDiscovery: row.autoDiscovery === 1,
        discoveryInterval: row.discoveryInterval,
        autoAddVariables: row.autoAddVariables === 1,
        defaultPollInterval: row.defaultPollInterval,
        symbolFilter: row.symbolFilter ? new RegExp(row.symbolFilter) : undefined
      },
      lastConnected: row.lastConnected,
      lastError: row.lastError
    }));
  }

  /**
   * Löscht eine ADS-Verbindung
   */
  deleteAdsConnection(connectionId: string): void {
    const stmt = this.db.prepare('DELETE FROM ads_connections WHERE id = ?');
    stmt.run(connectionId);
  }

  /**
   * Aktualisiert den Verbindungsstatus
   */
  updateConnectionStatus(connectionId: string, connected: boolean, error?: string): void {
    const stmt = this.db.prepare(`
      UPDATE ads_connections 
      SET lastConnected = ?, lastError = ?
      WHERE id = ?
    `);
    
    stmt.run(
      connected ? Date.now() : null,
      error || null,
      connectionId
    );
  }

  close(): void {
    this.db.close();
    console.log('[Persistence] Database closed');
  }
}
