# 🚀 ADS-MQTT Broker v4.0 - Schnellstart

## ✅ Aktueller Status

**v3.0 läuft bereits erfolgreich auf:**
- REST API: http://localhost:8080/api
- Admin Dashboard: http://localhost:8080/admin-dashboard-v4.html
- MQTT: mqtt://localhost:1883

## ⚡ v4.0 mit Redis starten

### Schritt 1: Redis installieren (EINMALIG)

**Methode A - Automatisches Skript (empfohlen):**

1. **Rechtsklick** auf `install-redis.bat`
2. Wähle **"Als Administrator ausführen"**
3. Warte bis "Redis Installation Complete!" erscheint

**Methode B - Manuelle Installation:**

```powershell
# PowerShell als Administrator öffnen, dann:
choco install redis-64 -y
redis-server --service-install
redis-server --service-start
```

**Methode C - Memurai (Alternative):**

Download: https://www.memurai.com/get-memurai
Installiere und starte Memurai Desktop

### Schritt 2: v4.0 starten

**Einfach:** Doppelklick auf `start-v4.bat`

**Oder manuell:**
```bash
npm run dev:v4
```

### Schritt 3: Testen

```bash
# Health Check
curl http://localhost:8080/api/health

# Performance Metrics
curl http://localhost:8080/api/metrics

# Cache Stats
curl http://localhost:8080/api/cache/stats
```

## 🎯 Unterschied v3.0 vs v4.0

| Feature | v3.0 (läuft) | v4.0 (mit Redis) |
|---------|--------------|------------------|
| API Response | ~50ms | **<1ms** (cached) |
| Real-time Updates | MQTT | **MQTT + WebSocket** |
| Caching | In-Memory | **Redis Cache** |
| Task Processing | Synchron | **Async Queues** |
| Performance Monitor | Basic | **Nanosecond Precision** |

## 📊 v4.0 Neue Features

### WebSocket Real-time Updates:
```javascript
const socket = io('http://localhost:8080');

socket.on('connect', () => {
  socket.emit('subscribe:variable', 'var-123');
});

socket.on('variable:changed', (data) => {
  console.log('New value:', data.value);
});
```

### Neue API Endpoints:
```bash
# Performance Dashboard
GET /api/performance

# Cache Management
GET /api/cache/stats
POST /api/cache/clear

# Queue Management
GET /api/queue/stats
GET /api/queue/failed?queue=variable-write

# Buffer Statistics
GET /api/buffer/stats
```

### Performance Benchmarks:
```bash
npm run benchmark
```

Erwartete Ergebnisse:
- Event Bus: >2M ops/sec
- Redis GET: >100k ops/sec
- Buffer Push: >5M ops/sec
- API (cached): <1ms

## ⚠️ Troubleshooting

### "Redis is not running"
```bash
# Check Redis status
redis-cli ping
# Should return: PONG

# If not running, start Redis
redis-server
```

### "Admin-Rechte benötigt"
- Rechtsklick auf `install-redis.bat`
- "Als Administrator ausführen" wählen

### "Port already in use"
```bash
# v3.0 läuft noch - stoppen mit:
taskkill /IM node.exe /F

# Oder v3.0 weiterlaufen lassen und v4.0 auf anderem Port:
# In .env: API_PORT=9000
```

## 📚 Weitere Dokumentation

- [README-v4.md](README-v4.md) - Vollständige Dokumentation
- [QUICKSTART-v4.md](QUICKSTART-v4.md) - Detaillierte Anleitung
- [V4-SUMMARY.md](V4-SUMMARY.md) - Implementation Details
- [STATUS.md](STATUS.md) - Aktueller Status

## 🎉 Quick Commands

```bash
# v3.0 (läuft bereits)
npm run dev:v3

# v4.0 (nach Redis Installation)
npm run dev:v4

# Build
npm run build

# Benchmarks (benötigt Redis)
npm run benchmark

# Tests
npm test
```

## 💡 Tipp

**Für sofortigen Produktiv-Einsatz:** Nutze v3.0 (läuft bereits!)

**Für Maximum Performance:** Installiere Redis und starte v4.0

---

**Made with ❤️ - ADS-MQTT Broker v4.0**
**Event-Driven Architecture • <1ms Performance • Redis Cache • WebSocket**
