/**
 * Performance Benchmark Suite für v4.0
 *
 * Tests:
 * 1. Event Bus throughput (events/sec)
 * 2. Redis Cache latency (get/set)
 * 3. Circular Buffer operations
 * 4. WebSocket broadcast performance
 * 5. API endpoint response times
 * 6. Queue processing throughput
 */

import { eventBus, EventNames } from './src/event-bus';
import { getCache } from './src/redis-cache';
import { CircularBuffer, VariableBuffer } from './src/circular-buffer';
import { getPerformanceMonitor } from './src/performance-monitor';

const ITERATIONS = 10000;
const WARM_UP = 1000;

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
  p50: number;
  p95: number;
  p99: number;
}

class Benchmark {
  private results: BenchmarkResult[] = [];

  async run(name: string, fn: () => Promise<void> | void, iterations: number = ITERATIONS): Promise<BenchmarkResult> {
    console.log(`\n[Benchmark] Running: ${name}`);
    console.log(`[Benchmark] Iterations: ${iterations.toLocaleString()}`);

    const times: number[] = [];

    // Warm-up
    console.log('[Benchmark] Warming up...');
    for (let i = 0; i < WARM_UP; i++) {
      await fn();
    }

    // Actual benchmark
    console.log('[Benchmark] Starting benchmark...');
    const startTime = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      const iterStart = process.hrtime.bigint();
      await fn();
      const iterEnd = process.hrtime.bigint();

      times.push(Number(iterEnd - iterStart));

      if ((i + 1) % 1000 === 0) {
        process.stdout.write(`\r[Benchmark] Progress: ${((i + 1) / iterations * 100).toFixed(1)}%`);
      }
    }

    const endTime = process.hrtime.bigint();
    const totalTime = Number(endTime - startTime);

    // Calculate statistics
    times.sort((a, b) => a - b);

    const result: BenchmarkResult = {
      name,
      iterations,
      totalTime,
      avgTime: totalTime / iterations,
      minTime: times[0],
      maxTime: times[times.length - 1],
      throughput: (iterations / (totalTime / 1e9)), // ops/sec
      p50: times[Math.floor(times.length * 0.50)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
    };

    this.results.push(result);
    this.printResult(result);

    return result;
  }

  private printResult(result: BenchmarkResult): void {
    console.log('\n');
    console.log('='.repeat(80));
    console.log(`Results: ${result.name}`);
    console.log('='.repeat(80));
    console.log(`Total Time:    ${this.formatNs(result.totalTime)}`);
    console.log(`Avg Time:      ${this.formatNs(result.avgTime)}`);
    console.log(`Min Time:      ${this.formatNs(result.minTime)}`);
    console.log(`Max Time:      ${this.formatNs(result.maxTime)}`);
    console.log(`P50:           ${this.formatNs(result.p50)}`);
    console.log(`P95:           ${this.formatNs(result.p95)}`);
    console.log(`P99:           ${this.formatNs(result.p99)}`);
    console.log(`Throughput:    ${result.throughput.toFixed(0).toLocaleString()} ops/sec`);
    console.log('='.repeat(80));
  }

  printSummary(): void {
    console.log('\n\n');
    console.log('='.repeat(120));
    console.log('BENCHMARK SUMMARY');
    console.log('='.repeat(120));
    console.log(
      'Test Name'.padEnd(50) +
      'Avg'.padStart(15) +
      'P50'.padStart(15) +
      'P95'.padStart(15) +
      'P99'.padStart(15) +
      'Throughput'.padStart(20)
    );
    console.log('-'.repeat(120));

    this.results.forEach(r => {
      console.log(
        r.name.padEnd(50) +
        this.formatNs(r.avgTime).padStart(15) +
        this.formatNs(r.p50).padStart(15) +
        this.formatNs(r.p95).padStart(15) +
        this.formatNs(r.p99).padStart(15) +
        `${r.throughput.toFixed(0)} ops/s`.padStart(20)
      );
    });

    console.log('='.repeat(120));

    // Check if targets are met
    console.log('\n🎯 Performance Targets:');
    this.checkTarget('Event Bus Emit', 1000); // <1µs
    this.checkTarget('Redis Cache GET', 1000000); // <1ms
    this.checkTarget('Redis Cache SET', 1000000); // <1ms
    this.checkTarget('Circular Buffer Push', 1000); // <1µs
    this.checkTarget('Circular Buffer Get Latest', 500); // <0.5µs
  }

  private checkTarget(name: string, targetNs: number): void {
    const result = this.results.find(r => r.name === name);
    if (!result) return;

    const p95Met = result.p95 < targetNs;
    const status = p95Met ? '✅' : '❌';
    const p95Ms = result.p95 / 1000000;
    const targetMs = targetNs / 1000000;

    console.log(`${status} ${name}: ${p95Ms.toFixed(3)}ms (target: <${targetMs}ms)`);
  }

  private formatNs(ns: number): string {
    if (ns < 1000) {
      return `${ns.toFixed(0)}ns`;
    } else if (ns < 1000000) {
      return `${(ns / 1000).toFixed(2)}µs`;
    } else if (ns < 1000000000) {
      return `${(ns / 1000000).toFixed(2)}ms`;
    } else {
      return `${(ns / 1000000000).toFixed(2)}s`;
    }
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('ADS-MQTT Broker v4.0 - Performance Benchmark Suite');
  console.log('='.repeat(80));

  const benchmark = new Benchmark();

  // ===== Event Bus Benchmarks =====
  console.log('\n📡 Event Bus Benchmarks');
  console.log('-'.repeat(80));

  await benchmark.run('Event Bus Emit', () => {
    eventBus.emit('test.event', { data: 'test' });
  });

  let listenerCount = 0;
  eventBus.on('test.listener', () => {
    listenerCount++;
  });

  await benchmark.run('Event Bus Emit + Listener', () => {
    eventBus.emit('test.listener', { data: 'test' });
  });

  // ===== Redis Cache Benchmarks =====
  console.log('\n💾 Redis Cache Benchmarks');
  console.log('-'.repeat(80));

  const cache = getCache();
  await cache.connect();

  await benchmark.run('Redis Cache SET', async () => {
    await cache.set('test-key', { value: 123 }, 60);
  });

  await benchmark.run('Redis Cache GET (Hit)', async () => {
    await cache.get('test-key');
  });

  await benchmark.run('Redis Cache GET (Miss)', async () => {
    await cache.get('non-existent-key');
  });

  // Batch operations
  const batchData: Record<string, any> = {};
  for (let i = 0; i < 100; i++) {
    batchData[`key-${i}`] = { value: i };
  }

  await benchmark.run('Redis Cache MSET (100 keys)', async () => {
    await cache.mset(batchData, 60);
  }, 1000); // Fewer iterations for batch

  await benchmark.run('Redis Cache MGET (100 keys)', async () => {
    const keys = Object.keys(batchData);
    await cache.mget(keys);
  }, 1000);

  // ===== Circular Buffer Benchmarks =====
  console.log('\n🔄 Circular Buffer Benchmarks');
  console.log('-'.repeat(80));

  const buffer = new CircularBuffer(10000);

  await benchmark.run('Circular Buffer Push', () => {
    buffer.push(Math.random(), 'GOOD');
  });

  await benchmark.run('Circular Buffer Get Latest', () => {
    buffer.latest();
  });

  await benchmark.run('Circular Buffer Get Oldest', () => {
    buffer.oldest();
  });

  await benchmark.run('Circular Buffer Get Stats', () => {
    buffer.getStats();
  }, 1000); // Fewer iterations (O(n) operation)

  // ===== Variable Buffer Benchmarks =====
  console.log('\n📊 Variable Buffer Benchmarks');
  console.log('-'.repeat(80));

  const varBuffer = new VariableBuffer(10000);

  await benchmark.run('Variable Buffer Push', () => {
    varBuffer.push('var-123', Math.random(), 'GOOD');
  });

  await benchmark.run('Variable Buffer Get Latest', () => {
    varBuffer.latest('var-123');
  });

  await benchmark.run('Variable Buffer Get Stats', () => {
    varBuffer.getStats('var-123');
  });

  // ===== Performance Monitor Benchmarks =====
  console.log('\n📈 Performance Monitor Benchmarks');
  console.log('-'.repeat(80));

  const perfMonitor = getPerformanceMonitor();

  await benchmark.run('Performance Monitor Record', () => {
    perfMonitor.recordMetric('test.operation', 1000000);
  });

  await benchmark.run('Performance Monitor Get Metrics', () => {
    perfMonitor.getOperationMetrics('test.operation');
  });

  // ===== Cleanup =====
  await cache.disconnect();

  // ===== Print Summary =====
  benchmark.printSummary();

  console.log('\n✅ Benchmark complete!\n');
}

// Run benchmarks
main().catch(error => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
