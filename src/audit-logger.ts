import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLog {
  id: string;
  timestamp: Date;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'READ' | 'VALUE_CHANGE' | 'CREATE_ROUTE' | 'DELETE_ROUTE' | 'TEST_ROUTE';
  variableId?: string;
  variableName?: string;
  userId?: string;
  userIp?: string;
  userAgent?: string;
  oldValue?: any;
  newValue?: any;
  details: string;
  status: 'SUCCESS' | 'FAILED';
}

export class AuditLogger extends EventEmitter {
  private logs: Map<string, AuditLog> = new Map();
  private maxLogs: number = 10000;

  constructor() {
    super();
  }

  log(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const auditLog: AuditLog = {
      id: uuidv4(),
      timestamp: new Date(),
      ...log,
    };

    this.logs.set(auditLog.id, auditLog);

    // Keep only max logs in memory
    if (this.logs.size > this.maxLogs) {
      const firstKey = this.logs.keys().next().value;
      if (firstKey) {
        this.logs.delete(firstKey);
      }
    }

    this.emit('audit-log', auditLog);
    return auditLog;
  }

  getVariableHistory(variableId: string, limit: number = 100): AuditLog[] {
    return Array.from(this.logs.values())
      .filter(log => log.variableId === variableId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  getAllLogs(limit: number = 100): AuditLog[] {
    return Array.from(this.logs.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  getLogsByUser(userId: string, limit: number = 100): AuditLog[] {
    return Array.from(this.logs.values())
      .filter(log => log.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  getLogsByAction(action: AuditLog['action'], limit: number = 100): AuditLog[] {
    return Array.from(this.logs.values())
      .filter(log => log.action === action)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  clearOldLogs(olderThanMinutes: number = 1440): number {
    const now = Date.now();
    const cutoff = now - olderThanMinutes * 60 * 1000;
    let removed = 0;

    this.logs.forEach((log, id) => {
      if (log.timestamp.getTime() < cutoff) {
        this.logs.delete(id);
        removed++;
      }
    });

    return removed;
  }

  getStats() {
    const logs = Array.from(this.logs.values());
    const actions = new Map<string, number>();
    const users = new Map<string, number>();
    const statuses = new Map<string, number>();

    logs.forEach(log => {
      actions.set(log.action, (actions.get(log.action) || 0) + 1);
      if (log.userId) {
        users.set(log.userId, (users.get(log.userId) || 0) + 1);
      }
      statuses.set(log.status, (statuses.get(log.status) || 0) + 1);
    });

    return {
      totalLogs: logs.length,
      actionStats: Object.fromEntries(actions),
      userStats: Object.fromEntries(users),
      statusStats: Object.fromEntries(statuses),
      oldestLog: logs.length > 0 ? logs[logs.length - 1].timestamp : null,
      newestLog: logs.length > 0 ? logs[0].timestamp : null,
    };
  }
}
