/**
 * Circular Buffer - Memory-efficient data structure für v4.0
 *
 * Features:
 * - Fixed-size ring buffer
 * - O(1) read/write operations
 * - Zero memory allocations after initialization
 * - Automatic overwrite of oldest data
 * - Thread-safe for single producer/consumer
 */

export interface BufferEntry<T = any> {
  timestamp: number;
  value: T;
  quality?: 'GOOD' | 'BAD' | 'UNCERTAIN';
}

export class CircularBuffer<T = any> {
  private buffer: BufferEntry<T>[];
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private readonly capacity: number;

  constructor(capacity: number = 1000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Add entry to buffer (O(1))
   */
  push(value: T, quality: 'GOOD' | 'BAD' | 'UNCERTAIN' = 'GOOD'): void {
    const entry: BufferEntry<T> = {
      timestamp: Date.now(),
      value,
      quality,
    };

    this.buffer[this.tail] = entry;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    } else {
      // Overwrite oldest entry
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Get latest entry (O(1))
   */
  latest(): BufferEntry<T> | null {
    if (this.size === 0) return null;

    const index = this.tail === 0 ? this.capacity - 1 : this.tail - 1;
    return this.buffer[index];
  }

  /**
   * Get oldest entry (O(1))
   */
  oldest(): BufferEntry<T> | null {
    if (this.size === 0) return null;
    return this.buffer[this.head];
  }

  /**
   * Get entry at index from head (O(1))
   */
  at(index: number): BufferEntry<T> | null {
    if (index < 0 || index >= this.size) return null;
    const actualIndex = (this.head + index) % this.capacity;
    return this.buffer[actualIndex];
  }

  /**
   * Get all entries in chronological order (O(n))
   */
  toArray(): BufferEntry<T>[] {
    if (this.size === 0) return [];

    const result: BufferEntry<T>[] = new Array(this.size);

    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.capacity;
      result[i] = this.buffer[index];
    }

    return result;
  }

  /**
   * Get entries within time range (O(n))
   */
  getRange(startTime: number, endTime: number): BufferEntry<T>[] {
    const result: BufferEntry<T>[] = [];

    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.capacity;
      const entry = this.buffer[index];

      if (entry.timestamp >= startTime && entry.timestamp <= endTime) {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * Get last N entries (O(n))
   */
  getLast(n: number): BufferEntry<T>[] {
    const count = Math.min(n, this.size);
    const result: BufferEntry<T>[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const index = (this.tail - count + i + this.capacity) % this.capacity;
      result[i] = this.buffer[index];
    }

    return result;
  }

  /**
   * Calculate statistics (O(n))
   */
  getStats(): {
    count: number;
    min?: number;
    max?: number;
    avg?: number;
    latest?: T;
  } {
    if (this.size === 0) {
      return { count: 0 };
    }

    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    let sum = 0;

    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.capacity;
      const value = this.buffer[index].value;

      if (typeof value === 'number') {
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
      }
    }

    const latest = this.latest();

    return {
      count: this.size,
      min: min === Number.MAX_VALUE ? undefined : min,
      max: max === Number.MIN_VALUE ? undefined : max,
      avg: sum / this.size,
      latest: latest?.value,
    };
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /**
   * Get current size
   */
  length(): number {
    return this.size;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this.size === this.capacity;
  }

  /**
   * Get capacity
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): number {
    // Rough estimate in bytes
    const entrySize = 32; // timestamp (8) + value (8-16) + quality (8)
    return this.capacity * entrySize;
  }
}

/**
 * Variable Value Buffer - Specialized for variable values
 */
export class VariableBuffer {
  private buffers: Map<string, CircularBuffer<any>> = new Map();
  private readonly defaultCapacity: number;

  constructor(defaultCapacity: number = 1000) {
    this.defaultCapacity = defaultCapacity;
  }

  /**
   * Get or create buffer for variable
   */
  private getBuffer(variableId: string): CircularBuffer<any> {
    let buffer = this.buffers.get(variableId);

    if (!buffer) {
      buffer = new CircularBuffer(this.defaultCapacity);
      this.buffers.set(variableId, buffer);
    }

    return buffer;
  }

  /**
   * Add value to variable buffer
   */
  push(variableId: string, value: any, quality: 'GOOD' | 'BAD' | 'UNCERTAIN' = 'GOOD'): void {
    const buffer = this.getBuffer(variableId);
    buffer.push(value, quality);
  }

  /**
   * Get latest value for variable
   */
  latest(variableId: string): BufferEntry<any> | null {
    const buffer = this.buffers.get(variableId);
    return buffer ? buffer.latest() : null;
  }

  /**
   * Get history for variable
   */
  getHistory(
    variableId: string,
    startTime?: number,
    endTime?: number,
    limit?: number
  ): BufferEntry<any>[] {
    const buffer = this.buffers.get(variableId);
    if (!buffer) return [];

    if (startTime && endTime) {
      return buffer.getRange(startTime, endTime);
    }

    if (limit) {
      return buffer.getLast(limit);
    }

    return buffer.toArray();
  }

  /**
   * Get statistics for variable
   */
  getStats(variableId: string): ReturnType<CircularBuffer['getStats']> {
    const buffer = this.buffers.get(variableId);
    return buffer ? buffer.getStats() : { count: 0 };
  }

  /**
   * Clear buffer for variable
   */
  clear(variableId: string): void {
    const buffer = this.buffers.get(variableId);
    if (buffer) {
      buffer.clear();
    }
  }

  /**
   * Remove buffer for variable
   */
  remove(variableId: string): void {
    this.buffers.delete(variableId);
  }

  /**
   * Get all variable IDs with buffers
   */
  getVariableIds(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Get total number of buffered variables
   */
  getVariableCount(): number {
    return this.buffers.size;
  }

  /**
   * Get total memory usage
   */
  getTotalMemoryUsage(): number {
    let total = 0;
    this.buffers.forEach(buffer => {
      total += buffer.getMemoryUsage();
    });
    return total;
  }

  /**
   * Get buffer statistics summary
   */
  getSummary(): {
    variableCount: number;
    totalEntries: number;
    memoryUsageBytes: number;
    memoryUsageMB: number;
  } {
    let totalEntries = 0;

    this.buffers.forEach(buffer => {
      totalEntries += buffer.length();
    });

    const memoryUsageBytes = this.getTotalMemoryUsage();

    return {
      variableCount: this.buffers.size,
      totalEntries,
      memoryUsageBytes,
      memoryUsageMB: parseFloat((memoryUsageBytes / 1024 / 1024).toFixed(2)),
    };
  }

  /**
   * Clear all buffers
   */
  clearAll(): void {
    this.buffers.forEach(buffer => buffer.clear());
  }

  /**
   * Remove all buffers
   */
  removeAll(): void {
    this.buffers.clear();
  }
}
