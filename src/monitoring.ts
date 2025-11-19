import { EventEmitter } from 'events';
import * as os from 'os';
import { PersistenceLayer } from './persistence';

export interface SystemHealth {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  process: {
    uptime: number;
    memory: NodeJS.MemoryUsage;
    pid: number;
  };
  timestamp: number;
}

export interface MqttMetrics {
  totalClients: number;
  totalSubscriptions: number;
  messagesReceived: number;
  messagesPublished: number;
  bytesReceived: number;
  bytesPublished: number;
  timestamp: number;
}

export interface AdsMetrics {
  totalVariables: number;
  activePolls: number;
  errors: number;
  lastErrorTime?: number;
  connected: boolean;
  timestamp: number;
}

export interface ApiMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  requestsPerMinute: number;
  timestamp: number;
}

export class MonitoringService extends EventEmitter {
  private persistence: PersistenceLayer;
  private monitoringInterval?: NodeJS.Timeout;
  private metricsInterval = 10000; // 10 seconds

  // Metrics counters
  private mqttMetrics: MqttMetrics = {
    totalClients: 0,
    totalSubscriptions: 0,
    messagesReceived: 0,
    messagesPublished: 0,
    bytesReceived: 0,
    bytesPublished: 0,
    timestamp: Date.now()
  };

  private adsMetrics: AdsMetrics = {
    totalVariables: 0,
    activePolls: 0,
    errors: 0,
    connected: false,
    timestamp: Date.now()
  };

  private apiMetrics: ApiMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgResponseTime: 0,
    requestsPerMinute: 0,
    timestamp: Date.now()
  };

  private responseTimes: number[] = [];
  private requestTimestamps: number[] = [];

  constructor(persistence: PersistenceLayer) {
    super();
    this.persistence = persistence;
  }

  start(): void {
    console.log('[Monitoring] Service started');

    // Collect metrics every interval
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.metricsInterval);

    // Immediate collection
    this.collectSystemMetrics();
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    console.log('[Monitoring] Service stopped');
  }

  private collectSystemMetrics(): void {
    const now = Date.now();

    // System Health
    const health = this.getSystemHealth();

    // Save to persistence (with validation)
    const cpuUsage = isNaN(health.cpu.usage) ? 0 : health.cpu.usage;
    const memoryUsage = isNaN(health.memory.usedPercent) ? 0 : health.memory.usedPercent;

    this.persistence.saveSystemMetric({
      timestamp: now,
      metricType: 'cpu',
      value: cpuUsage
    });

    this.persistence.saveSystemMetric({
      timestamp: now,
      metricType: 'memory',
      value: memoryUsage
    });

    this.persistence.saveSystemMetric({
      timestamp: now,
      metricType: 'mqtt_clients',
      value: this.mqttMetrics.totalClients || 0
    });

    this.persistence.saveSystemMetric({
      timestamp: now,
      metricType: 'mqtt_messages',
      value: this.mqttMetrics.messagesPublished || 0
    });

    this.persistence.saveSystemMetric({
      timestamp: now,
      metricType: 'ads_errors',
      value: this.adsMetrics.errors || 0
    });

    this.persistence.saveSystemMetric({
      timestamp: now,
      metricType: 'api_requests',
      value: this.apiMetrics.totalRequests || 0
    });

    // Emit event
    this.emit('metrics-collected', {
      system: health,
      mqtt: this.mqttMetrics,
      ads: this.adsMetrics,
      api: this.apiMetrics
    });
  }

  getSystemHealth(): SystemHealth {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Calculate CPU usage (simplified)
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    });

    const cpuUsage = 100 - ~~(100 * totalIdle / totalTick);

    return {
      cpu: {
        usage: cpuUsage,
        cores: cpus.length,
        model: cpus[0]?.model || 'Unknown'
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usedPercent: (usedMem / totalMem) * 100
      },
      process: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid
      },
      timestamp: Date.now()
    };
  }

  // ===== MQTT Metrics =====

  updateMqttMetrics(metrics: Partial<MqttMetrics>): void {
    this.mqttMetrics = {
      ...this.mqttMetrics,
      ...metrics,
      timestamp: Date.now()
    };
  }

  incrementMqttMessages(type?: 'received' | 'published', bytes?: number): void {
    if (type === 'received') {
      this.mqttMetrics.messagesReceived++;
      this.mqttMetrics.bytesReceived += bytes || 0;
    } else {
      this.mqttMetrics.messagesPublished++;
      this.mqttMetrics.bytesPublished += bytes || 0;
    }
  }

  incrementMqttClients(): void {
    this.mqttMetrics.totalClients++;
  }

  decrementMqttClients(): void {
    this.mqttMetrics.totalClients--;
  }

  getMqttMetrics(): MqttMetrics {
    return { ...this.mqttMetrics };
  }

  // ===== ADS Metrics =====

  updateAdsMetrics(metrics: Partial<AdsMetrics>): void {
    this.adsMetrics = {
      ...this.adsMetrics,
      ...metrics,
      timestamp: Date.now()
    };
  }

  incrementAdsError(): void {
    this.adsMetrics.errors++;
    this.adsMetrics.lastErrorTime = Date.now();
  }

  getAdsMetrics(): AdsMetrics {
    return { ...this.adsMetrics };
  }

  // ===== API Metrics =====

  recordApiRequest(success: boolean, responseTime: number): void {
    this.apiMetrics.totalRequests++;

    if (success) {
      this.apiMetrics.successfulRequests++;
    } else {
      this.apiMetrics.failedRequests++;
    }

    // Track response times (keep last 100)
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }

    // Calculate average
    if (this.responseTimes.length > 0) {
      const sum = this.responseTimes.reduce((a, b) => a + b, 0);
      this.apiMetrics.avgResponseTime = sum / this.responseTimes.length;
    }

    // Track request timestamps for RPM calculation
    const now = Date.now();
    this.requestTimestamps.push(now);

    // Remove timestamps older than 1 minute
    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);

    this.apiMetrics.requestsPerMinute = this.requestTimestamps.length;
    this.apiMetrics.timestamp = now;
  }

  getApiMetrics(): ApiMetrics {
    return { ...this.apiMetrics };
  }

  // ===== Historical Data =====

  getHistoricalMetrics(
    metricType: 'cpu' | 'memory' | 'mqtt_clients' | 'mqtt_messages' | 'ads_errors' | 'api_requests',
    startTime?: number,
    endTime?: number,
    limit: number = 1000
  ): any[] {
    return this.persistence.getSystemMetrics(metricType, startTime, endTime, limit);
  }

  // ===== Summary =====

  getSummary(): any {
    return {
      system: this.getSystemHealth(),
      mqtt: this.getMqttMetrics(),
      ads: this.getAdsMetrics(),
      api: this.getApiMetrics(),
      database: this.persistence.getDatabaseStats()
    };
  }

  // ===== Reference setters for index-v3.ts =====

  private adsConnectionManager: any = null;
  private mqttBroker: any = null;

  setAdsConnectionManager(manager: any): void {
    this.adsConnectionManager = manager;
  }

  setMqttBroker(broker: any): void {
    this.mqttBroker = broker;
  }
}
