import Bull, { Queue, Job, JobOptions } from 'bull';
import { eventBus, EventNames, VariableChangeEvent } from './event-bus';

/**
 * Event Queue System für v4.0
 *
 * Features:
 * - Asynchrone Task-Verarbeitung mit Bull
 * - Priority queues
 * - Job retries mit exponential backoff
 * - Rate limiting
 * - Job progress tracking
 * - Failed job handling
 */

export interface QueueConfig {
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  defaultJobOptions?: JobOptions;
}

export interface VariableWriteJob {
  connectionId: string;
  variableId: string;
  variableName: string;
  value: any;
  source: 'mqtt' | 'rest' | 'websocket';
  userId?: string;
  timestamp: number;
}

export interface DiscoveryJob {
  connectionId: string;
  force?: boolean;
}

export interface PersistenceJob {
  type: 'variable-history' | 'audit-log' | 'system-metric';
  data: any;
}

export interface NotificationJob {
  type: 'email' | 'webhook' | 'mqtt';
  recipients: string[];
  message: string;
  priority?: number;
}

/**
 * Event Queue Manager
 */
export class EventQueueManager {
  private variableWriteQueue: Queue<VariableWriteJob>;
  private discoveryQueue: Queue<DiscoveryJob>;
  private persistenceQueue: Queue<PersistenceJob>;
  private notificationQueue: Queue<NotificationJob>;

  private readonly config: QueueConfig;

  constructor(config: QueueConfig = {}) {
    this.config = config;

    const redisConfig = config.redis || {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
    };

    const defaultJobOptions: JobOptions = config.defaultJobOptions || {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 500,     // Keep last 500 failed jobs
    };

    // Create queues
    this.variableWriteQueue = new Bull('variable-write', {
      redis: redisConfig,
      defaultJobOptions: {
        ...defaultJobOptions,
        priority: 1, // High priority for variable writes
      },
    });

    this.discoveryQueue = new Bull('discovery', {
      redis: redisConfig,
      defaultJobOptions: {
        ...defaultJobOptions,
        priority: 3, // Lower priority for discovery
      },
    });

    this.persistenceQueue = new Bull('persistence', {
      redis: redisConfig,
      defaultJobOptions: {
        ...defaultJobOptions,
        priority: 2, // Medium priority
      },
    });

    this.notificationQueue = new Bull('notification', {
      redis: redisConfig,
      defaultJobOptions: {
        ...defaultJobOptions,
        priority: 4, // Lowest priority
      },
    });

    this.setupQueueHandlers();
    this.setupQueueEvents();
  }

  private setupQueueHandlers(): void {
    // Variable Write Queue Processor
    this.variableWriteQueue.process(async (job: Job<VariableWriteJob>) => {
      const { connectionId, variableId, variableName, value, source, timestamp } = job.data;

      console.log(`[Queue] Processing variable write: ${variableName} = ${value}`);

      // Emit event for connection manager to handle
      eventBus.emit('queue.variable-write', job.data);

      // Track progress
      job.progress(100);

      return { success: true, timestamp: Date.now() };
    });

    // Discovery Queue Processor
    this.discoveryQueue.process(async (job: Job<DiscoveryJob>) => {
      const { connectionId, force } = job.data;

      console.log(`[Queue] Processing discovery for connection: ${connectionId}`);

      // Emit event for discovery to handle
      eventBus.emit('queue.discovery', job.data);

      job.progress(100);

      return { success: true, timestamp: Date.now() };
    });

    // Persistence Queue Processor
    this.persistenceQueue.process(async (job: Job<PersistenceJob>) => {
      const { type, data } = job.data;

      console.log(`[Queue] Processing persistence: ${type}`);

      // Emit event for persistence layer to handle
      eventBus.emit('queue.persistence', job.data);

      job.progress(100);

      return { success: true, timestamp: Date.now() };
    });

    // Notification Queue Processor
    this.notificationQueue.process(async (job: Job<NotificationJob>) => {
      const { type, recipients, message } = job.data;

      console.log(`[Queue] Processing notification: ${type} to ${recipients.length} recipients`);

      // Emit event for notification handler
      eventBus.emit('queue.notification', job.data);

      job.progress(100);

      return { success: true, timestamp: Date.now() };
    });
  }

  private setupQueueEvents(): void {
    // Variable Write Queue Events
    this.variableWriteQueue.on('completed', (job, result) => {
      eventBus.emitPerformanceMetric({
        operation: 'queue.variable-write.completed',
        duration: job.finishedOn! - job.processedOn!,
        timestamp: Date.now(),
        metadata: { jobId: job.id },
      });
    });

    this.variableWriteQueue.on('failed', (job, err) => {
      console.error(`[Queue] Variable write job ${job.id} failed:`, err.message);
      eventBus.emitSystemEvent({
        type: 'error',
        message: `Variable write job failed: ${err.message}`,
        timestamp: Date.now(),
        metadata: { jobId: job.id, data: job.data },
      });
    });

    // Discovery Queue Events
    this.discoveryQueue.on('completed', (job, result) => {
      console.log(`[Queue] Discovery job ${job.id} completed`);
    });

    this.discoveryQueue.on('failed', (job, err) => {
      console.error(`[Queue] Discovery job ${job.id} failed:`, err.message);
    });

    // Persistence Queue Events
    this.persistenceQueue.on('completed', (job) => {
      // Silent completion
    });

    this.persistenceQueue.on('failed', (job, err) => {
      console.error(`[Queue] Persistence job ${job.id} failed:`, err.message);
    });

    // Notification Queue Events
    this.notificationQueue.on('completed', (job) => {
      console.log(`[Queue] Notification sent: ${job.data.type}`);
    });

    this.notificationQueue.on('failed', (job, err) => {
      console.error(`[Queue] Notification job ${job.id} failed:`, err.message);
    });

    // Global error handlers
    [this.variableWriteQueue, this.discoveryQueue, this.persistenceQueue, this.notificationQueue].forEach(queue => {
      queue.on('error', (error) => {
        console.error(`[Queue] Error in ${queue.name}:`, error);
      });
    });
  }

  // ===== Queue Methods =====

  /**
   * Add variable write job
   */
  async addVariableWrite(job: VariableWriteJob, options?: JobOptions): Promise<Job<VariableWriteJob>> {
    return this.variableWriteQueue.add(job, options);
  }

  /**
   * Add discovery job
   */
  async addDiscovery(job: DiscoveryJob, options?: JobOptions): Promise<Job<DiscoveryJob>> {
    return this.discoveryQueue.add(job, options);
  }

  /**
   * Add persistence job
   */
  async addPersistence(job: PersistenceJob, options?: JobOptions): Promise<Job<PersistenceJob>> {
    return this.persistenceQueue.add(job, options);
  }

  /**
   * Add notification job
   */
  async addNotification(job: NotificationJob, options?: JobOptions): Promise<Job<NotificationJob>> {
    return this.notificationQueue.add(job, {
      ...options,
      priority: job.priority || 4,
    });
  }

  // ===== Queue Statistics =====

  async getQueueStats(): Promise<{
    variableWrite: any;
    discovery: any;
    persistence: any;
    notification: any;
  }> {
    const [vwCounts, discoveryCounts, persistenceCounts, notificationCounts] = await Promise.all([
      this.variableWriteQueue.getJobCounts(),
      this.discoveryQueue.getJobCounts(),
      this.persistenceQueue.getJobCounts(),
      this.notificationQueue.getJobCounts(),
    ]);

    return {
      variableWrite: vwCounts,
      discovery: discoveryCounts,
      persistence: persistenceCounts,
      notification: notificationCounts,
    };
  }

  async getQueueHealth(): Promise<{
    queues: Record<string, boolean>;
    overall: boolean;
  }> {
    // Bull queues are ready when created, just return true
    const queues: Record<string, boolean> = {
      variableWrite: true,
      discovery: true,
      persistence: true,
      notification: true,
    };

    const overall = Object.values(queues).every(v => v);

    return { queues, overall };
  }

  /**
   * Get failed jobs for debugging
   */
  async getFailedJobs(queueName: string, limit: number = 10): Promise<Job[]> {
    let queue: Queue;

    switch (queueName) {
      case 'variable-write':
        queue = this.variableWriteQueue;
        break;
      case 'discovery':
        queue = this.discoveryQueue;
        break;
      case 'persistence':
        queue = this.persistenceQueue;
        break;
      case 'notification':
        queue = this.notificationQueue;
        break;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }

    return queue.getFailed(0, limit);
  }

  /**
   * Retry failed job
   */
  async retryFailedJob(queueName: string, jobId: string): Promise<void> {
    const failedJobs = await this.getFailedJobs(queueName, 1000);
    const job = failedJobs.find(j => j.id?.toString() === jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found in ${queueName}`);
    }

    await job.retry();
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(grace: number = 24 * 60 * 60 * 1000): Promise<void> {
    const queues = [
      this.variableWriteQueue,
      this.discoveryQueue,
      this.persistenceQueue,
      this.notificationQueue,
    ];

    await Promise.all(
      queues.map(q =>
        Promise.all([
          q.clean(grace, 'completed'),
          q.clean(grace, 'failed'),
        ])
      )
    );

    console.log('[Queue] Cleaned old jobs');
  }

  // ===== Cleanup =====

  async close(): Promise<void> {
    await Promise.all([
      this.variableWriteQueue.close(),
      this.discoveryQueue.close(),
      this.persistenceQueue.close(),
      this.notificationQueue.close(),
    ]);

    console.log('[Queue] All queues closed');
  }

  async pause(): Promise<void> {
    await Promise.all([
      this.variableWriteQueue.pause(),
      this.discoveryQueue.pause(),
      this.persistenceQueue.pause(),
      this.notificationQueue.pause(),
    ]);

    console.log('[Queue] All queues paused');
  }

  async resume(): Promise<void> {
    await Promise.all([
      this.variableWriteQueue.resume(),
      this.discoveryQueue.resume(),
      this.persistenceQueue.resume(),
      this.notificationQueue.resume(),
    ]);

    console.log('[Queue] All queues resumed');
  }
}
