import Redis, { Redis as RedisClient, RedisOptions } from 'ioredis';
import * as msgpack from 'msgpack-lite';
import { eventBus, EventNames, CacheEvent } from './event-bus';

/**
 * Redis Cache Layer für v4.0
 *
 * Features:
 * - Connection pooling für hohe Performance
 * - MessagePack serialization (schneller als JSON)
 * - TTL-basiertes Caching
 * - Pub/Sub support
 * - Automatic reconnection
 * - Event-driven cache invalidation
 */

export interface CacheOptions {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  enableOfflineQueue?: boolean;
  maxRetriesPerRequest?: number;
  retryStrategy?: (times: number) => number | void;
}

export interface CacheEntry<T = any> {
  value: T;
  timestamp: number;
  ttl?: number;
}

export class RedisCache {
  private client: RedisClient;
  private pubClient: RedisClient;
  private subClient: RedisClient;
  private readonly keyPrefix: string;
  private hitCount = 0;
  private missCount = 0;
  private setCount = 0;

  constructor(options: CacheOptions = {}) {
    this.keyPrefix = options.keyPrefix || 'ads-broker:';

    const redisOptions: RedisOptions = {
      host: options.host || process.env.REDIS_HOST || 'localhost',
      port: options.port || parseInt(process.env.REDIS_PORT || '6379'),
      password: options.password || process.env.REDIS_PASSWORD,
      db: options.db || 0,
      enableOfflineQueue: options.enableOfflineQueue !== false,
      maxRetriesPerRequest: options.maxRetriesPerRequest || 3,
      retryStrategy: options.retryStrategy || ((times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }),
      lazyConnect: true,
      enableReadyCheck: true,
      showFriendlyErrorStack: true,
    };

    // Main client for get/set operations
    this.client = new Redis(redisOptions);

    // Separate clients for pub/sub
    this.pubClient = new Redis(redisOptions);
    this.subClient = new Redis(redisOptions);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      console.log('[Redis] Connected to Redis server');
    });

    this.client.on('ready', () => {
      console.log('[Redis] Redis client ready');
    });

    this.client.on('error', (error) => {
      console.error('[Redis] Error:', error.message);
      eventBus.emitSystemEvent({
        type: 'error',
        message: `Redis error: ${error.message}`,
        timestamp: Date.now(),
      });
    });

    this.client.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...');
    });

    // Pub/Sub event handlers
    this.subClient.on('message', (channel, message) => {
      this.handlePubSubMessage(channel, message);
    });
  }

  async connect(): Promise<void> {
    try {
      await Promise.all([
        this.client.connect(),
        this.pubClient.connect(),
        this.subClient.connect(),
      ]);
      console.log('[Redis] All clients connected');
    } catch (error) {
      console.error('[Redis] Connection failed:', error);
      throw error;
    }
  }

  // ===== Cache Operations =====

  /**
   * Get value from cache with performance tracking
   */
  async get<T = any>(key: string): Promise<T | null> {
    const startTime = process.hrtime.bigint();
    const fullKey = this.keyPrefix + key;

    try {
      const data = await this.client.getBuffer(fullKey);

      if (!data) {
        this.missCount++;
        this.emitCacheEvent('miss', key);
        return null;
      }

      const entry = msgpack.decode(data) as CacheEntry<T>;

      // Check if entry is expired
      if (entry.ttl && (Date.now() - entry.timestamp) > entry.ttl * 1000) {
        await this.delete(key);
        this.missCount++;
        this.emitCacheEvent('miss', key);
        return null;
      }

      this.hitCount++;
      this.emitCacheEvent('hit', key);

      return entry.value;
    } finally {
      const duration = Number(process.hrtime.bigint() - startTime);
      eventBus.emitPerformanceMetric({
        operation: 'cache.get',
        duration,
        timestamp: Date.now(),
        metadata: { key },
      });
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    const startTime = process.hrtime.bigint();
    const fullKey = this.keyPrefix + key;

    try {
      const entry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
        ttl,
      };

      const data = msgpack.encode(entry);

      if (ttl) {
        await this.client.setex(fullKey, ttl, data);
      } else {
        await this.client.set(fullKey, data);
      }

      this.setCount++;
      this.emitCacheEvent('set', key, ttl);
    } finally {
      const duration = Number(process.hrtime.bigint() - startTime);
      eventBus.emitPerformanceMetric({
        operation: 'cache.set',
        duration,
        timestamp: Date.now(),
        metadata: { key, ttl },
      });
    }
  }

  /**
   * Delete key from cache
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = this.keyPrefix + key;
    const result = await this.client.del(fullKey);

    if (result > 0) {
      this.emitCacheEvent('delete', key);
      return true;
    }
    return false;
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.keyPrefix + key;
    const result = await this.client.exists(fullKey);
    return result === 1;
  }

  /**
   * Increment counter atomically
   */
  async increment(key: string, by: number = 1): Promise<number> {
    const fullKey = this.keyPrefix + key;
    return await this.client.incrby(fullKey, by);
  }

  /**
   * Get multiple keys at once (pipeline)
   */
  async mget<T = any>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];

    const fullKeys = keys.map(k => this.keyPrefix + k);
    const pipeline = this.client.pipeline();

    fullKeys.forEach(key => pipeline.getBuffer(key));

    const results = await pipeline.exec();

    return results?.map((result, index) => {
      if (result && result[1]) {
        const entry = msgpack.decode(result[1] as Buffer) as CacheEntry<T>;
        this.hitCount++;
        return entry.value;
      }
      this.missCount++;
      return null;
    }) || [];
  }

  /**
   * Set multiple keys at once (pipeline)
   */
  async mset<T = any>(entries: Record<string, T>, ttl?: number): Promise<void> {
    const pipeline = this.client.pipeline();

    Object.entries(entries).forEach(([key, value]) => {
      const fullKey = this.keyPrefix + key;
      const entry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
        ttl,
      };
      const data = msgpack.encode(entry);

      if (ttl) {
        pipeline.setex(fullKey, ttl, data);
      } else {
        pipeline.set(fullKey, data);
      }
    });

    await pipeline.exec();
    this.setCount += Object.keys(entries).length;
  }

  /**
   * Invalidate all keys matching pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    const fullPattern = this.keyPrefix + pattern;
    const keys = await this.client.keys(fullPattern);

    if (keys.length === 0) return 0;

    const result = await this.client.del(...keys);

    this.emitCacheEvent('invalidate', pattern);

    return result;
  }

  // ===== Pub/Sub Operations =====

  /**
   * Publish message to channel
   */
  async publish(channel: string, message: any): Promise<void> {
    const data = msgpack.encode(message);
    await this.pubClient.publish(this.keyPrefix + channel, data);
  }

  /**
   * Subscribe to channel
   */
  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    const fullChannel = this.keyPrefix + channel;

    // Store handler for later
    this.subClient.on('message', (ch, msg) => {
      if (ch === fullChannel) {
        try {
          const data = msgpack.decode(Buffer.from(msg, 'binary'));
          handler(data);
        } catch (error) {
          console.error('[Redis] Failed to decode pub/sub message:', error);
        }
      }
    });

    await this.subClient.subscribe(fullChannel);
  }

  /**
   * Unsubscribe from channel
   */
  async unsubscribe(channel: string): Promise<void> {
    await this.subClient.unsubscribe(this.keyPrefix + channel);
  }

  private handlePubSubMessage(channel: string, message: string): void {
    // Event is handled by registered listeners
  }

  // ===== Statistics =====

  getStats(): {
    hits: number;
    misses: number;
    sets: number;
    hitRate: number;
    totalOperations: number;
  } {
    const total = this.hitCount + this.missCount;
    const hitRate = total > 0 ? (this.hitCount / total) * 100 : 0;

    return {
      hits: this.hitCount,
      misses: this.missCount,
      sets: this.setCount,
      hitRate: parseFloat(hitRate.toFixed(2)),
      totalOperations: total,
    };
  }

  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
    this.setCount = 0;
  }

  async getInfo(): Promise<string> {
    return await this.client.info();
  }

  async getMemoryUsage(): Promise<any> {
    const info = await this.client.info('memory');
    return info;
  }

  // ===== Helper Methods =====

  private emitCacheEvent(operation: CacheEvent['operation'], key: string, ttl?: number): void {
    eventBus.emitCacheEvent({
      operation,
      key,
      timestamp: Date.now(),
      ttl,
    });
  }

  // ===== Cleanup =====

  async disconnect(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.pubClient.quit(),
      this.subClient.quit(),
    ]);
    console.log('[Redis] All clients disconnected');
  }

  async flushAll(): Promise<void> {
    await this.client.flushdb();
    console.log('[Redis] Cache flushed');
  }
}

// Singleton instance
let cacheInstance: RedisCache | null = null;

export function getCache(options?: CacheOptions): RedisCache {
  if (!cacheInstance) {
    cacheInstance = new RedisCache(options);
  }
  return cacheInstance;
}
