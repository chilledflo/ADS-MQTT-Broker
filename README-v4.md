# ADS-MQTT Broker v4.0 - Event-Driven Architecture

Ein hochperformanter MQTT-Broker mit Beckhoff ADS-Gateway-Integration, Event-Driven Architecture, Redis Cache, WebSocket Support und **<1ms Performance**.

## 🚀 v4.0 Highlights

### ⚡ Performance
- **<1ms** API response time für gecachte Daten
- **<5ms** Variable Updates vom ADS zum MQTT Publish
- **<1ms** WebSocket Broadcast Latency
- **<0.5ms** Event Propagation durch den Event Bus
- **Nanosekunden-Präzision** Performance Monitoring

### 🏗️ Architektur
- **Event-Driven Architecture** - Vollständig reaktive Architektur mit zentralem Event Bus
- **Redis Cache Layer** - Distributed Caching mit Connection Pooling
- **WebSocket Server** - Real-time bidirektionale Kommunikation
- **Bull Queue System** - Asynchrone Task-Verarbeitung mit Priority Queues
- **Circular Buffers** - Memory-efficient In-Memory Storage
- **Performance Monitoring** - Microsecond-precision Metrics

## 📋 Neue Features in v4.0

### 1. Central Event Bus
```typescript
// Typisierte Events mit Namespaces
eventBus.emitVariableChanged({
  connectionId: 'plc-1',
  variableId: 'var-123',
  value: 42.5,
  timestamp: Date.now(),
  quality: 'GOOD',
  source: 'ads'
});

// Event Listener
eventBus.on(EventNames.VARIABLE_CHANGED, (event) => {
  console.log(`Variable ${event.variableName} changed to ${event.value}`);
});
```

### 2. Redis Cache Layer
```typescript
// High-speed caching mit MessagePack serialization
const cache = getCache();

// Set mit TTL
await cache.set('variable:123', data, 60); // 60 seconds

// Get mit Performance Tracking
const value = await cache.get('variable:123');

// Batch operations
await cache.mset(multipleValues, 30);
const values = await cache.mget(keys);
```

### 3. WebSocket Real-time Updates
```typescript
// Client-seitiger Code
const socket = io('ws://localhost:8080');

// Subscribe zu Variable Updates
socket.emit('subscribe:variable', 'var-123');

// Empfange Updates
socket.on('variable:changed', (data) => {
  console.log(`New value: ${data.value}`);
});

// Write Variable
socket.emit('variable:write', {
  connectionId: 'plc-1',
  variableId: 'var-123',
  value: 100
});
```

### 4. Event Queue System
```typescript
// Asynchrone Variable Writes
await queue.addVariableWrite({
  connectionId: 'plc-1',
  variableId: 'var-123',
  value: 42,
  source: 'rest',
  timestamp: Date.now()
});

// Symbol Discovery Queue
await queue.addDiscovery({
  connectionId: 'plc-1',
  force: true
});
```

### 5. Circular Buffer Storage
```typescript
// Memory-efficient In-Memory Storage
const buffer = new VariableBuffer(10000); // 10k entries per variable

// Push value
buffer.push('var-123', 42.5, 'GOOD');

// Get latest
const latest = buffer.latest('var-123');

// Get history
const history = buffer.getHistory('var-123', startTime, endTime);

// Get statistics
const stats = buffer.getStats('var-123');
// { count, min, max, avg, latest }
```

### 6. Performance Monitoring
```typescript
const monitor = getPerformanceMonitor();

// Automatic measurement
await monitor.measure('api.getVariable', async () => {
  // Your code here
});

// Manual recording
const stopTimer = monitor.startTimer();
// ... operation ...
const duration = stopTimer(); // nanoseconds
monitor.recordMetric('operation.name', duration);

// Get metrics
const metrics = monitor.getOperationMetrics('api.getVariable');
// { count, avgDuration, p50, p95, p99, ... }

// Get report
console.log(monitor.getSummaryReport());
```

## 📦 Installation & Setup

### 1. Dependencies installieren
```bash
npm install
```

### 2. Redis Server starten
```bash
# Docker
docker run -d -p 6379:6379 redis:alpine

# Oder lokal
redis-server
```

### 3. Umgebungsvariablen konfigurieren
```bash
cp .env.example .env
```

Beispiel `.env`:
```env
# MQTT
MQTT_PORT=1883
MQTT_HOST=0.0.0.0

# API
API_PORT=8080
API_HOST=0.0.0.0

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ADS (optional - für Default Connection)
ADS_HOST=192.168.1.10
ADS_PORT=48898
ADS_TARGET_IP=192.168.1.10
ADS_TARGET_PORT=801
ADS_SOURCE_PORT=32750

# Performance
DEBUG_EVENTS=false
```

### 4. Broker starten

```bash
# Development Mode
npm run dev:v4

# Production Build & Start
npm run build
npm run start:v4
```

## 🌐 Access Points

| Service | URL | Port | Beschreibung |
|---------|-----|------|--------------|
| REST API | `http://localhost:8080/api` | 8080 | HTTP REST API v4 |
| WebSocket | `ws://localhost:8080` | 8080 | Socket.IO WebSocket |
| MQTT Broker | `mqtt://localhost:1883` | 1883 | MQTT Protocol |
| Health Check | `http://localhost:8080/api/health` | 8080 | System Health |
| Metrics | `http://localhost:8080/api/metrics` | 8080 | Performance Metrics |
| Performance | `http://localhost:8080/api/performance` | 8080 | Detailed Performance |

## 🔧 API Endpoints (v4)

### Health & Metrics
```bash
# System Health
GET /api/health

# Overall Status
GET /api/status

# Performance Metrics
GET /api/metrics

# Detailed Performance Report
GET /api/performance
```

### Connections
```bash
# List all connections
GET /api/connections

# Get connection details
GET /api/connections/:id

# Create new connection
POST /api/connections

# Update connection
PUT /api/connections/:id

# Delete connection
DELETE /api/connections/:id

# Connect/Disconnect
POST /api/connections/:id/connect
POST /api/connections/:id/disconnect
```

### Variables
```bash
# List variables (optional: ?connectionId=xxx)
GET /api/variables

# Get variable details
GET /api/variables/:id

# Create variable
POST /api/variables

# Update variable
PUT /api/variables/:id

# Delete variable
DELETE /api/variables/:id

# Write variable value (queued)
POST /api/variables/:id/write
Body: { "value": 42 }

# Get variable history (from buffer)
GET /api/variables/:id/history?startTime=xxx&endTime=xxx&limit=100

# Get variable statistics
GET /api/variables/:id/stats
```

### Discovery
```bash
# Trigger symbol discovery
POST /api/connections/:id/discover

# Get discovered symbols
GET /api/connections/:id/symbols
```

### Cache Management
```bash
# Clear all cache
POST /api/cache/clear

# Get cache statistics
GET /api/cache/stats
```

### Queue Management
```bash
# Get queue statistics
GET /api/queue/stats

# Get failed jobs
GET /api/queue/failed?queue=variable-write

# Retry failed job
POST /api/queue/retry/:id
Body: { "queue": "variable-write" }
```

### Buffer Statistics
```bash
# Get buffer summary
GET /api/buffer/stats
```

## 🌐 WebSocket Events

### Client → Server

```javascript
// Subscribe to connection updates
socket.emit('subscribe:connection', 'plc-1');

// Subscribe to variable updates
socket.emit('subscribe:variable', 'var-123');

// Subscribe to MQTT topic
socket.emit('subscribe:topic', 'sensors/#');

// Write variable
socket.emit('variable:write', {
  connectionId: 'plc-1',
  variableId: 'var-123',
  value: 100
});

// Get variable history
socket.emit('variable:history', {
  variableId: 'var-123',
  startTime: Date.now() - 3600000,
  limit: 100
}, (history) => {
  console.log(history);
});

// Get connection status
socket.emit('connections:status', (status) => {
  console.log(status);
});

// Get statistics
socket.emit('stats', (stats) => {
  console.log(stats);
});
```

### Server → Client

```javascript
// Variable changed
socket.on('variable:changed', (data) => {
  console.log(data);
  // { variableId, variableName, value, timestamp, quality, source }
});

// Connection events
socket.on('connection:established', (data) => {});
socket.on('connection:lost', (data) => {});
socket.on('connection:error', (data) => {});

// Symbol discovery
socket.on('symbols:discovered', (data) => {});
socket.on('online-change', (data) => {});

// System events
socket.on('system:error', (data) => {});
socket.on('system:warning', (data) => {});

// Acknowledgements
socket.on('variable:write:ack', (data) => {});
socket.on('variable:write:error', (error) => {});
```

## 📊 Performance Benchmarks

### Running Benchmarks
```bash
npm run benchmark
```

### Expected Results

| Operation | Avg Latency | P95 Latency | Throughput |
|-----------|-------------|-------------|------------|
| Event Bus Emit | <500ns | <1µs | >2M ops/sec |
| Redis GET (Hit) | <500µs | <1ms | >100k ops/sec |
| Redis SET | <500µs | <1ms | >100k ops/sec |
| Circular Buffer Push | <200ns | <500ns | >5M ops/sec |
| Buffer Get Latest | <100ns | <200ns | >10M ops/sec |
| API GET (Cached) | <500µs | <1ms | >100k req/sec |

## 🏗️ Architektur-Diagramm

```
┌─────────────────────────────────────────────────────────────┐
│                    ADS-MQTT Broker v4.0                      │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  REST API v4 │───▶│  Event Bus   │◀───│  WebSocket   │
│  (Express)   │    │ (EventEmit2) │    │  (Socket.IO) │
└───────┬──────┘    └──────┬───────┘    └──────┬───────┘
        │                  │                    │
        │         ┌────────┴────────┐          │
        │         │                 │          │
        ▼         ▼                 ▼          ▼
┌──────────────────────────────────────────────────────┐
│              Central Event Bus                        │
│  • variable.changed    • mqtt.message                │
│  • connection.*        • discovery.*                 │
│  • performance.*       • cache.*                     │
└──────────┬──────────────────────────┬────────────────┘
           │                          │
           ▼                          ▼
┌─────────────────┐         ┌─────────────────┐
│  Redis Cache    │         │  Bull Queues    │
│  • Variables    │         │  • Var Writes   │
│  • Connections  │         │  • Discovery    │
│  • Symbols      │         │  • Persistence  │
└─────────────────┘         └─────────────────┘
           │                          │
           ▼                          ▼
┌─────────────────────────────────────────────────────┐
│           ADS Connection Manager                     │
│  • Multiple Connections                             │
│  • Symbol Discovery                                 │
│  • OnlineChange Detection                           │
└────────────┬────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│              Circular Buffers                        │
│  • In-Memory History (10k entries/variable)         │
│  • O(1) Read/Write                                  │
│  • Zero allocations                                 │
└─────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────┐
│          SQLite Persistence Layer                    │
│  • Long-term History                                │
│  • Audit Logs                                       │
│  • System Metrics                                   │
└─────────────────────────────────────────────────────┘
```

## 🎯 Performance Optimierungen

### 1. Redis Caching Strategy
- **TTL**: 1-5 Sekunden für häufig gelesene Daten
- **Invalidation**: Event-driven bei Änderungen
- **MessagePack**: Binär-Serialisierung (schneller als JSON)
- **Pipeline**: Batch-Operationen für hohen Durchsatz

### 2. Circular Buffers
- **Fixed Size**: Keine Memory Allocations zur Laufzeit
- **O(1) Operations**: Push, Get Latest, Get Oldest
- **Memory Efficient**: ~32 Bytes pro Entry
- **10k Entries/Variable**: ~320KB pro Variable

### 3. Event Bus
- **Namespaced Events**: Effiziente Event-Filterung
- **Wildcard Support**: `variable.*` matcht alle Variable Events
- **Low Overhead**: <1µs Event Emission
- **Typed Events**: TypeScript Interfaces

### 4. WebSocket
- **MessagePack Protocol**: Binär statt JSON
- **Room-based Broadcasting**: Nur an interessierte Clients
- **Automatic Reconnection**: Client-seitig
- **Compression**: Optional aktivierbar

### 5. Queue System
- **Priority Queues**: Variable Writes haben höchste Priorität
- **Automatic Retry**: Exponential Backoff
- **Rate Limiting**: Verhindert Überlastung
- **Job Cleanup**: Automatisches Löschen alter Jobs

## 🔍 Monitoring & Debugging

### Performance Monitoring
```javascript
const monitor = getPerformanceMonitor();

// Detailed report (console)
console.log(monitor.getSummaryReport());

// Get specific operation metrics
const metrics = monitor.getOperationMetrics('api.getVariable');

// Check if operation meets target
const isUnder1ms = monitor.isUnderTarget('api.getVariable', 1000000); // 1ms in ns

// Get slow operations
const slowOps = monitor.getSlowOperations(1); // p95 > 1ms
```

### Event Bus Debugging
```env
# In .env
DEBUG_EVENTS=true
```

Aktiviert detailliertes Event-Logging im Event Bus.

### Cache Statistics
```bash
curl http://localhost:8080/api/cache/stats
```

Zeigt Hit Rate, Miss Rate, Total Operations.

### Queue Health
```bash
curl http://localhost:8080/api/queue/stats
```

Zeigt Job Counts (waiting, active, completed, failed) für alle Queues.

## 🐳 Docker Deployment

### docker-compose.yml
```yaml
version: '3.8'

services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  ads-broker:
    build: .
    ports:
      - "1883:1883"
      - "8080:8080"
    depends_on:
      - redis
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MQTT_PORT=1883
      - API_PORT=8080
    volumes:
      - ./data:/app/data

volumes:
  redis-data:
```

### Start
```bash
docker-compose up -d
```

## 📈 Scaling & Production

### Horizontal Scaling
v4.0 ist vorbereitet für horizontales Scaling:

- **Redis**: Shared Cache zwischen Instanzen
- **Bull Queues**: Redis-backed, mehrere Workers möglich
- **WebSocket**: Sticky Sessions oder Redis Adapter
- **Event Bus**: Kann mit Redis Pub/Sub erweitert werden

### Production Checklist

- [ ] Redis persistence aktiviert (AOF oder RDB)
- [ ] Redis memory limit gesetzt
- [ ] Environment Variables gesetzt
- [ ] Monitoring/Alerting konfiguriert
- [ ] Backup-Strategie für SQLite DB
- [ ] Firewall-Regeln konfiguriert
- [ ] SSL/TLS für Production
- [ ] Rate Limiting aktiviert
- [ ] Logging Level auf 'info' oder 'warn'

## 🔧 Troubleshooting

### Redis Connection Failed
```bash
# Check Redis
redis-cli ping

# Check connectivity
telnet localhost 6379
```

### High Memory Usage
```bash
# Check buffer stats
curl http://localhost:8080/api/buffer/stats

# Reduce buffer size in code
const buffer = new VariableBuffer(1000); // Smaller buffer
```

### Slow Performance
```bash
# Check performance metrics
curl http://localhost:8080/api/performance

# Identify slow operations
npm run benchmark
```

### Queue Stuck
```bash
# Check queue health
curl http://localhost:8080/api/queue/stats

# Get failed jobs
curl http://localhost:8080/api/queue/failed?queue=variable-write

# Retry failed job
curl -X POST http://localhost:8080/api/queue/retry/123 \
  -H "Content-Type: application/json" \
  -d '{"queue": "variable-write"}'
```

## 📝 Migration von v3.0 zu v4.0

### Breaking Changes
1. **Redis Required**: v4.0 benötigt einen Redis Server
2. **New API Responses**: Cache-Header (`X-Cache: HIT/MISS`)
3. **Event System**: Interne Events nutzen jetzt EventEmitter2

### Migration Steps
1. Redis installieren und starten
2. Environment Variables aktualisieren
3. Code auf neue API umstellen
4. Tests anpassen
5. Performance-Benchmarks ausführen

### Compatibility
- v4.0 ist **rückwärtskompatibel** mit v3.0 REST API
- MQTT Protocol unverändert
- ADS Connection Config unverändert

## 🎓 Weitere Ressourcen

- [Event-Driven Architecture Best Practices](https://martinfowler.com/articles/201701-event-driven.html)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [Bull Queue Guide](https://github.com/OptimalBits/bull)

## 📄 Lizenz

MIT - Frei verwendbar für private und kommerzielle Projekte

---

**Version**: 4.0.0
**Status**: Production Ready ✅
**Performance**: <1ms ⚡
