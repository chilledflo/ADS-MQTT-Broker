import { EventEmitter } from 'events';

export interface SystemError {
  id: string;
  timestamp: Date;
  level: 'error' | 'warning' | 'info';
  source: string;
  message: string;
  details?: any;
  resolved: boolean;
}

/**
 * Error Manager - Tracks and manages system errors
 */
export class ErrorManager extends EventEmitter {
  private errors: Map<string, SystemError> = new Map();
  private maxErrors: number = 100;

  constructor() {
    super();
  }

  /**
   * Add a new error
   */
  addError(error: Omit<SystemError, 'id' | 'timestamp' | 'resolved'>): SystemError {
    const systemError: SystemError = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      resolved: false,
      ...error
    };

    this.errors.set(systemError.id, systemError);

    // Limit error count
    if (this.errors.size > this.maxErrors) {
      const firstKey = this.errors.keys().next().value;
      if (firstKey) {
        this.errors.delete(firstKey);
      }
    }

    console.error(`[Error Manager] ${error.level.toUpperCase()} from ${error.source}: ${error.message}`);
    this.emit('error-added', systemError);

    return systemError;
  }

  /**
   * Resolve an error
   */
  resolveError(errorId: string): void {
    const error = this.errors.get(errorId);
    if (error) {
      error.resolved = true;
      this.emit('error-resolved', error);
    }
  }

  /**
   * Get all errors
   */
  getAllErrors(includeResolved: boolean = false): SystemError[] {
    return Array.from(this.errors.values())
      .filter(e => includeResolved || !e.resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get unresolved errors count
   */
  getUnresolvedCount(): number {
    return Array.from(this.errors.values()).filter(e => !e.resolved).length;
  }

  /**
   * Get errors by level
   */
  getErrorsByLevel(level: 'error' | 'warning' | 'info'): SystemError[] {
    return Array.from(this.errors.values())
      .filter(e => e.level === level && !e.resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Clear all resolved errors
   */
  clearResolvedErrors(): void {
    Array.from(this.errors.entries()).forEach(([id, error]) => {
      if (error.resolved) {
        this.errors.delete(id);
      }
    });
  }

  /**
   * Clear all errors
   */
  clearAllErrors(): void {
    this.errors.clear();
    this.emit('errors-cleared');
  }
}
