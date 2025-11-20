import { EventEmitter2 } from 'eventemitter2';

/**
 * Event Bus - Central Event System für v4.0
 *
 * Event-Driven Architecture mit Namespaces für:
 * - ADS Variable Changes
 * - MQTT Messages
 * - REST API Requests
 * - System Events
 * - Performance Metrics
 */

// ===== Event Payloads =====

export interface VariableChangeEvent {
  connectionId: string;
  variableId: string;
  variableName: string;
  value: any;
  oldValue?: any;
  timestamp: number;
  quality: 'GOOD' | 'BAD' | 'UNCERTAIN';
  source: 'ads' | 'mqtt' | 'rest' | 'websocket';
}

export interface MqttMessageEvent {
  topic: string;
  payload: any;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
  clientId?: string;
}

export interface ConnectionEvent {
  connectionId: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  error?: Error;
  timestamp: number;
}

export interface DiscoveryEvent {
  connectionId: string;
  symbolCount: number;
  variableCount?: number;
  version?: number;
  timestamp: number;
}

export interface PerformanceMetric {
  operation: string;
  duration: number; // nanoseconds
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface SystemEvent {
  type: 'startup' | 'shutdown' | 'error' | 'warning' | 'info';
  message: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface CacheEvent {
  operation: 'hit' | 'miss' | 'set' | 'delete' | 'invalidate';
  key: string;
  timestamp: number;
  ttl?: number;
}

export interface WebSocketEvent {
  event: string;
  clientId: string;
  data?: any;
  timestamp: number;
}

// ===== Event Names (Namespaced) =====

export const EventNames = {
  // Variable Events
  VARIABLE_CHANGED: 'variable.changed',
  VARIABLE_CREATED: 'variable.created',
  VARIABLE_DELETED: 'variable.deleted',
  VARIABLE_ERROR: 'variable.error',

  // MQTT Events
  MQTT_MESSAGE_RECEIVED: 'mqtt.message.received',
  MQTT_MESSAGE_PUBLISHED: 'mqtt.message.published',
  MQTT_CLIENT_CONNECTED: 'mqtt.client.connected',
  MQTT_CLIENT_DISCONNECTED: 'mqtt.client.disconnected',

  // Connection Events
  CONNECTION_ESTABLISHED: 'connection.established',
  CONNECTION_LOST: 'connection.lost',
  CONNECTION_ERROR: 'connection.error',

  // Discovery Events
  SYMBOLS_DISCOVERED: 'discovery.symbols',
  ONLINE_CHANGE_DETECTED: 'discovery.online_change',
  VARIABLES_AUTO_ADDED: 'discovery.variables_added',

  // Performance Events
  PERFORMANCE_METRIC: 'performance.metric',
  LATENCY_MEASURED: 'performance.latency',

  // System Events
  SYSTEM_STARTUP: 'system.startup',
  SYSTEM_SHUTDOWN: 'system.shutdown',
  SYSTEM_ERROR: 'system.error',
  SYSTEM_WARNING: 'system.warning',

  // Cache Events
  CACHE_HIT: 'cache.hit',
  CACHE_MISS: 'cache.miss',
  CACHE_SET: 'cache.set',
  CACHE_INVALIDATED: 'cache.invalidated',

  // WebSocket Events
  WS_CLIENT_CONNECTED: 'ws.client.connected',
  WS_CLIENT_DISCONNECTED: 'ws.client.disconnected',
  WS_MESSAGE_SENT: 'ws.message.sent',
  WS_MESSAGE_RECEIVED: 'ws.message.received',
} as const;

/**
 * Central Event Bus Singleton
 */
export class CentralEventBus extends EventEmitter2 {
  private static instance: CentralEventBus;
  private metricsBuffer: PerformanceMetric[] = [];
  private readonly MAX_METRICS_BUFFER = 1000;

  private constructor() {
    super({
      wildcard: true,
      delimiter: '.',
      maxListeners: 100,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    });

    this.setupInternalListeners();
  }

  static getInstance(): CentralEventBus {
    if (!CentralEventBus.instance) {
      CentralEventBus.instance = new CentralEventBus();
    }
    return CentralEventBus.instance;
  }

  private setupInternalListeners(): void {
    // Performance metrics aggregation
    this.on(EventNames.PERFORMANCE_METRIC, (metric: PerformanceMetric) => {
      this.metricsBuffer.push(metric);
      if (this.metricsBuffer.length > this.MAX_METRICS_BUFFER) {
        this.metricsBuffer.shift();
      }
    });

    // Debug logging (can be disabled in production)
    if (process.env.DEBUG_EVENTS === 'true') {
      this.onAny((event, value) => {
        console.log(`[EventBus] ${event}:`, value);
      });
    }
  }

  // ===== Typed Event Emitters =====

  emitVariableChanged(event: VariableChangeEvent): void {
    this.emit(EventNames.VARIABLE_CHANGED, event);
  }

  emitMqttMessage(event: MqttMessageEvent): void {
    this.emit(EventNames.MQTT_MESSAGE_RECEIVED, event);
  }

  emitConnectionEvent(event: ConnectionEvent): void {
    const eventName = event.status === 'connected'
      ? EventNames.CONNECTION_ESTABLISHED
      : event.status === 'disconnected'
      ? EventNames.CONNECTION_LOST
      : EventNames.CONNECTION_ERROR;

    this.emit(eventName, event);
  }

  emitPerformanceMetric(metric: PerformanceMetric): void {
    this.emit(EventNames.PERFORMANCE_METRIC, metric);
  }

  emitSystemEvent(event: SystemEvent): void {
    const eventName = `system.${event.type}`;
    this.emit(eventName, event);
  }

  emitCacheEvent(event: CacheEvent): void {
    const eventName = `cache.${event.operation}`;
    this.emit(eventName, event);
  }

  // ===== Metrics & Statistics =====

  getRecentMetrics(limit: number = 100): PerformanceMetric[] {
    return this.metricsBuffer.slice(-limit);
  }

  getMetricsByOperation(operation: string): PerformanceMetric[] {
    return this.metricsBuffer.filter(m => m.operation === operation);
  }

  getAverageLatency(operation: string): number {
    const metrics = this.getMetricsByOperation(operation);
    if (metrics.length === 0) return 0;

    const sum = metrics.reduce((acc, m) => acc + m.duration, 0);
    return sum / metrics.length;
  }

  getPercentile(operation: string, percentile: number): number {
    const metrics = this.getMetricsByOperation(operation)
      .map(m => m.duration)
      .sort((a, b) => a - b);

    if (metrics.length === 0) return 0;

    const index = Math.ceil((percentile / 100) * metrics.length) - 1;
    return metrics[index];
  }

  // ===== Event Statistics =====

  getEventStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    const names = this.eventNames() as string[];

    names.forEach(name => {
      stats[name] = this.listenerCount(name);
    });

    return stats;
  }

  clearMetrics(): void {
    this.metricsBuffer = [];
  }

  // ===== Cleanup =====

  destroy(): void {
    this.removeAllListeners();
    this.clearMetrics();
  }
}

// Export singleton instance
export const eventBus = CentralEventBus.getInstance();
