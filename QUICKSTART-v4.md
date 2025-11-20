# ADS-MQTT Broker v4.0 - Quick Start Guide

Schnellstart-Anleitung für die Installation und Nutzung von v4.0.

## ⚡ 5-Minuten Quick Start

### 1. Redis installieren und starten

**Option A: Docker (empfohlen)**
```bash
docker run -d -p 6379:6379 --name redis redis:alpine
```

**Option B: Windows (Chocolatey)**
```bash
choco install redis-64
redis-server
```

**Option C: Linux/Mac (Homebrew)**
```bash
brew install redis
redis-server
```

### 2. Dependencies installieren
```bash
npm install
```

### 3. Broker starten
```bash
npm run dev:v4
```

Das war's! Der Broker läuft jetzt auf:
- REST API: http://localhost:8080/api
- WebSocket: ws://localhost:8080
- MQTT: mqtt://localhost:1883

## 🧪 Testen

### Health Check
```bash
curl http://localhost:8080/api/health
```

Erwartete Antwort:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-20T...",
  "uptime": 123.45,
  "cache": {
    "hits": 0,
    "misses": 0,
    "hitRate": 0
  },
  "queue": {
    "overall": true
  },
  "websocket": {
    "clients": 0
  }
}
```

### Performance Metrics
```bash
curl http://localhost:8080/api/metrics
```

### WebSocket Test (Browser Console)
```javascript
const socket = io('http://localhost:8080');

socket.on('connect', () => {
  console.log('Connected!');

  // Subscribe zu Variable
  socket.emit('subscribe:variable', 'test-var');
});

socket.on('variable:changed', (data) => {
  console.log('Variable changed:', data);
});
```

## 🎯 Performance Benchmark

```bash
npm run benchmark
```

Erwartet:
- Event Bus: >2M ops/sec
- Redis GET: >100k ops/sec
- Circular Buffer: >5M ops/sec
- Alle Operationen <1ms (p95)

## 📝 Erste ADS Connection erstellen

### Via REST API
```bash
curl -X POST http://localhost:8080/api/connections \
  -H "Content-Type: application/json" \
  -d '{
    "id": "plc-1",
    "name": "Production PLC",
    "host": "192.168.1.10",
    "port": 48898,
    "targetIp": "192.168.1.10",
    "targetPort": 801,
    "sourcePort": 32750,
    "enabled": true,
    "symbolDiscovery": {
      "autoDiscovery": true,
      "discoveryInterval": 30000,
      "autoAddVariables": true,
      "defaultPollInterval": 1000,
      "symbolFilter": "^GVL\\."
    }
  }'
```

### Via Environment Variables (.env)
```env
ADS_HOST=192.168.1.10
ADS_PORT=48898
ADS_TARGET_IP=192.168.1.10
ADS_TARGET_PORT=801
ADS_SOURCE_PORT=32750
```

Broker neu starten - Default Connection wird automatisch erstellt.

## 🌐 WebSocket Client Beispiel

### HTML + JavaScript
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
</head>
<body>
  <h1>ADS-MQTT Broker v4.0 Client</h1>
  <div id="status"></div>
  <div id="variables"></div>

  <script>
    const socket = io('http://localhost:8080');

    socket.on('connect', () => {
      document.getElementById('status').innerHTML = '✅ Connected';

      // Subscribe to all variable changes on connection
      socket.emit('subscribe:connection', 'plc-1');
    });

    socket.on('disconnect', () => {
      document.getElementById('status').innerHTML = '❌ Disconnected';
    });

    socket.on('variable:changed', (data) => {
      const div = document.getElementById('variables');
      const line = `${data.variableName}: ${data.value} (${new Date(data.timestamp).toLocaleTimeString()})`;
      div.innerHTML = line + '<br>' + div.innerHTML;
    });

    // Write variable
    function writeVariable(id, value) {
      socket.emit('variable:write', {
        connectionId: 'plc-1',
        variableId: id,
        value: value
      });
    }
  </script>
</body>
</html>
```

## 📊 Monitoring Dashboard

### Real-time Metrics
```bash
# Terminal 1: Start broker
npm run dev:v4

# Terminal 2: Watch metrics
watch -n 1 'curl -s http://localhost:8080/api/metrics | jq .'
```

### Performance Report (alle 5 Min)
Der Broker gibt automatisch alle 5 Minuten einen Performance-Report in der Konsole aus:

```
================================================================================
Performance Monitor Summary
================================================================================
Total Operations: 1,234,567
Average Latency: 234.56µs
Max Latency: 12.34ms
Operations/sec: 4,115

Top Operations:
--------------------------------------------------------------------------------
Operation                      Count         Avg         P50         P95         P99
--------------------------------------------------------------------------------
api.GET./api/variables         50000      456.23µs    400.00µs    800.00µs     1.20ms
event.variable.changed        100000       23.45µs     20.00µs     40.00µs     60.00µs
cache.get                     150000      234.56µs    200.00µs    500.00µs    800.00µs
================================================================================
```

## 🐛 Troubleshooting

### Redis Connection Failed
```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If not running, start it
docker start redis
# or
redis-server
```

### Port Already in Use
```bash
# Change ports in .env
API_PORT=9000
MQTT_PORT=1884
REDIS_PORT=6380

# Restart broker
npm run dev:v4
```

### High Memory Usage
```bash
# Check buffer stats
curl http://localhost:8080/api/buffer/stats

# Response shows memory usage:
{
  "variableCount": 100,
  "totalEntries": 50000,
  "memoryUsageBytes": 1600000,
  "memoryUsageMB": 1.53
}

# Reduce buffer size in .env
BUFFER_SIZE=1000
```

## 🚀 Production Deployment

### 1. Build
```bash
npm run build
```

### 2. Set Production Environment
```bash
export NODE_ENV=production
export DEBUG_EVENTS=false
```

### 3. Start
```bash
npm run start:v4
```

### 4. Process Manager (PM2)
```bash
npm install -g pm2

pm2 start dist/index-v4.js --name ads-broker-v4
pm2 save
pm2 startup
```

### 5. Docker Compose
```yaml
version: '3.8'

services:
  redis:
    image: redis:alpine
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  broker:
    build: .
    restart: always
    ports:
      - "1883:1883"
      - "8080:8080"
    depends_on:
      - redis
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
    volumes:
      - ./data:/app/data

volumes:
  redis-data:
```

Start:
```bash
docker-compose up -d
```

## 📈 Next Steps

1. ✅ Broker läuft
2. 📖 Lies [README-v4.md](README-v4.md) für Details
3. 🔧 Konfiguriere ADS Connections
4. 📊 Erstelle Dashboard/Client
5. 🎯 Führe Benchmarks aus: `npm run benchmark`
6. 🚀 Deploy to Production

## 💡 Tipps

### Cache Hit Rate optimieren
- Verwende passende TTL-Werte in .env
- Monitoring: `curl http://localhost:8080/api/cache/stats`
- Ziel: >80% Hit Rate

### Performance überwachen
```bash
# Slow operations (p95 > 1ms)
curl http://localhost:8080/api/performance | jq '.operations | to_entries | map(select(.value.p95 > 1000000))'
```

### WebSocket Performance
- Nutze Rooms für gezieltes Broadcasting
- Subscribe nur zu benötigten Events
- MessagePack Parser ist automatisch aktiviert

### Queue Health
```bash
# Check queue stats
curl http://localhost:8080/api/queue/stats

# Failed jobs
curl "http://localhost:8080/api/queue/failed?queue=variable-write"
```

## 🎓 Weitere Ressourcen

- [README-v4.md](README-v4.md) - Vollständige Dokumentation
- [API Dokumentation](README-v4.md#-api-endpoints-v4)
- [WebSocket Events](README-v4.md#-websocket-events)
- [Performance Tuning](README-v4.md#-performance-optimierungen)

---

**Viel Erfolg mit v4.0!** 🚀
