# ADS-MQTT-Broker

Ein produktionsreifer MQTT-Broker mit Beckhoff ADS-Gateway-Integration, REST API, Audit-Logging und modernen Dashboards. Verfügbar als **Node.js** und **C++** Version mit harter Echtzeit (<5ms via ADS Device Notifications).

## 🎯 Features

### Node.js Version (aktuelles Repository)
- **MQTT Broker** - Aedes 5.0 Standard-konform (10.000+ msg/sec)
- **ADS Gateway** - Automatische Symbol-Discovery und Variable Polling
- **Multi-PLC Support** - Verwaltung mehrerer TwinCAT-PLCs
- **REST API** - Mit Audit-Logging und Datenherkunft-Tracking
- **Angular Dashboard** - Moderne Industrial Red Theme UI mit Chart.js
- **WebSocket Support** - Echtzeit-Updates für Live-Daten
- **Audit Logging** - Vollständige Protokollierung aller Aktivitäten
- **Docker Ready** - Containerisierung für Production Deployment

### C++ Version (separates Repository)
- **Ultra-Low Latency** - <1ms Reaktionszeit mit ADS Notifications
- **Multi-PLC Management** - Thread-sichere Verwaltung mehrerer PLCs
- **Symbol Discovery** - Automatisches Auslesen der PLC-Symboltabelle
- **Network Scanner** - Auto-Discovery von PLCs im Netzwerk
- **Native Performance** - Optimiert mit AVX2, LTO, O3
- **Cross-Platform** - Windows (MSVC) und Linux (GCC) Support

👉 **C++ Repository**: [ADS-MQTT-Broker-C++](https://github.com/chilledflo/ADS-MQTT-Broker-C-)

## 📦 Installation

```bash
# 1. Dependencies installieren
npm install

# 2. Build
npm run build

# 3. Starten
npm start
```

## 🌐 Zugriff

| Service | URL | Port |
|---------|-----|------|
| Angular Dashboard | http://localhost:4200 | 4200 |
| Admin Dashboard (Modern) | http://localhost:8080/admin-dashboard-modern.html | 8080 |
| Admin Dashboard (Simple) | http://localhost:8080/admin-dashboard-simple.html | 8080 |
| REST API | http://localhost:8080/api/ | 8080 |
| MQTT Broker | mqtt://localhost:1883 | 1883 |
| Health Check | http://localhost:8080/api/health | 8080 |

## 🗂️ Projektstruktur

```
ADS-MQTT-Broker/
├── src/                            # Node.js Backend
│   ├── index.ts                    # Main Entry Point
│   ├── ads-gateway.ts              # ADS Variable Polling & Notifications
│   ├── ads-connection-manager.ts   # Multi-PLC Connection Manager
│   ├── ads-symbol-discovery.ts     # Automatische Symbol Discovery
│   ├── mqtt-broker.ts              # MQTT Broker (Aedes)
│   ├── rest-api.ts                 # REST API mit Audit-Logging
│   ├── websocket-server.ts         # WebSocket für Live-Updates
│   ├── audit-logger.ts             # Audit Logger Service
│   ├── performance-monitor.ts      # Performance Monitoring
│   ├── redis-cache.ts              # Redis Caching Layer
│   └── monitoring.ts               # System Monitoring
│
├── ads-dashboard-angular/          # Angular 18 Dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── dashboard/      # Hauptdashboard mit Charts
│   │   │   │   └── kpi-card/       # KPI Karten Komponente
│   │   │   └── services/
│   │   │       └── ads.service.ts  # API Service
│   │   └── styles.scss             # Industrial Red Theme
│   └── angular.json
│
├── public/                         # Static HTML Dashboards
│   ├── dashboard-realtime.html     # Realtime Dashboard
│   ├── dashboard-v4.html           # V4 Dashboard
│   └── network-scanner.html        # Network Scanner UI
│
├── admin-dashboard-modern.html     # Modernes Admin Dashboard
├── admin-dashboard-simple.html     # Einfaches Admin Dashboard
├── dist/                           # Compiled JavaScript
├── test-broker.js                  # API Test Script
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 REST API Endpoints

### Variablen

```bash
# Alle Variablen
GET /api/variables

# Spezifische Variable mit Verlauf
GET /api/variables/{id}

# Neue Variable erstellen
POST /api/variables
{
  "name": "Temperatur_01",
  "path": "MAIN.Sensor1",
  "type": "REAL",
  "pollInterval": 1000
}

# Variable löschen
DELETE /api/variables/{id}
```

### Multi-PLC Verwaltung

```bash
# Alle PLC-Routes auflisten
GET /api/ads/routes

# Neue PLC-Route hinzufügen
POST /api/ads/routes
{
  "name": "PLC_Line1",
  "amsNetId": "192.168.3.42.1.1",
  "ipAddress": "192.168.3.42",
  "port": 851
}

# PLC-Route löschen
DELETE /api/ads/routes/{id}

# Symbol Discovery starten
POST /api/ads/discover
{
  "routeId": "route_id_here"
}
```

### Audit Logs

```bash
# Alle Audit-Logs
GET /api/audit/logs

# Verlauf einer Variablen
GET /api/audit/logs/variable/{id}

# Statistiken
GET /api/audit/stats
```

## 📊 Dashboards

### Angular Dashboard (Empfohlen)
- **Industrial Red Theme** - Modernes, responsives Design
- **Echtzeit-Charts** - Chart.js Integration mit Live-Updates
- **KPI Cards** - Übersichtliche Kennzahlen-Darstellung
- **Variable Management** - Vollständige CRUD-Operationen

```bash
cd ads-dashboard-angular
npm install
ng serve
# Öffne http://localhost:4200
```

### Admin Dashboard (HTML)

**Modern Version** (`admin-dashboard-modern.html`):
- Dunkles Theme mit rotem Akzent
- Responsives Grid-Layout
- Live-Updates via WebSocket
- Performance-Monitoring

**Simple Version** (`admin-dashboard-simple.html`):
- Leichtgewichtig und schnell
- Einfache Tabellen-Ansicht
- Grundlegende CRUD-Operationen

### Dashboard Features

1. **📊 Variablen** - Auflisten, Verwalten, Registrierungsinfo
2. **➕ Variable hinzufügen** - Neue Variable erstellen
3. **🏭 Multi-PLC** - PLC-Routes verwalten und überwachen
4. **🔍 Symbol Discovery** - Automatische Symboltabellen-Erkennung
5. **📋 Audit-Protokoll** - Alle Aktivitäten mit Filterung
6. **📈 Statistiken** - Aktions-, User- und Status-Statistiken

## 🔐 Audit-Logging

Jede Aktivität wird protokolliert mit:
- **Aktion**: CREATE, UPDATE, DELETE, VALUE_CHANGE, READ
- **Benutzer**: User-ID (via Header `x-user-id`)
- **Quelle**: IP-Adresse, User-Agent
- **Zeitstempel**: ISO 8601 Format
- **Status**: SUCCESS oder FAILED

## 🚀 Verwendungsbeispiele

### Mit curl

```bash
# Health Check
curl -H "x-user-id: admin" http://localhost:8080/api/health

# Variable erstellen
curl -X POST http://localhost:8080/api/variables \
  -H "Content-Type: application/json" \
  -H "x-user-id: admin" \
  -d '{
    "name": "Druck_01",
    "path": "MAIN.PressureSensor",
    "type": "REAL",
    "pollInterval": 500
  }'
```

### Mit MQTT

```bash
# Subscribe zu Variablen
mosquitto_sub -h localhost -t "variables/+/value"
```

## 🐳 Docker

```bash
# Image bauen
npm run docker:build

# Container starten
npm run docker:run
```

## 🧪 Tests

```bash
npm test
```

## 📝 Konfiguration

Kopieren Sie `.env.example` zu `.env` und passen Sie die Werte an:

```bash
MQTT_PORT=1883
API_PORT=8080
ADS_HOST=localhost
ADS_PORT=48898
```

### TwinCAT Route-Konfiguration

Für Details zur TwinCAT-Route-Verwaltung und DLL-Informationen siehe:
**[TWINCAT_ROUTE_DLL.md](TWINCAT_ROUTE_DLL.md)**

- Windows: TcAdsDll2.dll (TwinCAT 3) / TcAdsDll.dll (TwinCAT 2)
- Linux/Docker: Direkte TCP/IP-Verbindung, keine DLL erforderlich
- Route-Setup für verschiedene Szenarien

## 📚 Dokumentation

- `ADMIN_DASHBOARD_GUIDE.md` - Admin UI Dokumentation
- `SEPARATION_AND_AUDIT.md` - Detailed Guides
- `TWINCAT_ROUTE_DLL.md` - TwinCAT Route & DLL Dokumentation

## 🐛 Troubleshooting

**Port bereits belegt?**
```bash
API_PORT=9000 npm start
```

**ADS-Verbindung fehlgeschlagen?**
Der Broker läuft mit Mock-Daten für Development/Testing.
Für Route-Konfiguration siehe `TWINCAT_ROUTE_DLL.md`.

**Dashboard lädt nicht?**
```bash
curl http://localhost:8080/api/health
```

## 📊 Performance

### Node.js Version
- **MQTT Throughput**: Bis zu 10.000 Nachrichten/Sekunde
- **REST API Latenz**: < 50ms
- **ADS Notifications**: ~5ms Update-Latenz
- **WebSocket Updates**: < 10ms
- **Audit Logs**: Max. 10.000 In-Memory Einträge
- **Memory**: ~50-100MB Standard Setup
- **Multi-PLC**: Bis zu 10 PLCs gleichzeitig

### C++ Version (ADS-MQTT-Broker-C++)
- **Ultra-Low Latency**: <1ms mit ADS Device Notifications
- **Native Performance**: AVX2 + Link-Time Optimization
- **Memory Efficient**: <20MB RAM Usage
- **Thread-Safe**: std::mutex für Multi-PLC
- **Network Scanner**: Automatische PLC-Erkennung im Subnet
- **Symbol Discovery**: Vollständige Symboltabellen-Analyse

## 🔄 Vergleich: Node.js vs C++

| Feature | Node.js | C++ |
|---------|---------|-----|
| **Latenz** | ~5ms | <1ms |
| **Durchsatz** | 10.000 msg/s | 50.000+ msg/s |
| **Memory** | ~100MB | ~20MB |
| **Setup** | Einfach | Build-Tools erforderlich |
| **Cross-Platform** | ✅ Sofort | ⚙️ Kompilierung nötig |
| **Dashboard** | ✅ Angular + HTML | ⚠️ In Entwicklung |
| **Multi-PLC** | ✅ | ✅ |
| **Symbol Discovery** | ✅ | ✅ |
| **Use Case** | Development, Testing | Production, Hard Realtime |

## 🔄 Development

```bash
# Watch Mode
npm run watch

# Dev Server
npm run dev

# Linting
npm run lint
```

## 📄 Lizenz

MIT - Frei verwendbar für private und kommerzielle Projekte

## 🤝 Support

Für Fragen oder Issues, siehe Dokumentation oder erstellen Sie ein Issue.

## 🔗 Repositories

| Version | Repository | Status |
|---------|------------|--------|
| **Node.js** | [ADS-MQTT-Broker](https://github.com/chilledflo/ADS-MQTT-Broker) | ✅ Production Ready |
| **C++** | [ADS-MQTT-Broker-C++](https://github.com/chilledflo/ADS-MQTT-Broker-C-) | ⚙️ In Development |

## 🚦 Quick Start Guide

### Node.js Setup (Empfohlen für Development)
```bash
# 1. Repository klonen
git clone https://github.com/chilledflo/ADS-MQTT-Broker.git
cd ADS-MQTT-Broker

# 2. Dependencies installieren
npm install

# 3. Build & Start
npm run build
npm start

# 4. Dashboard öffnen
# http://localhost:8080/admin-dashboard-modern.html

# 5. Angular Dashboard (optional)
cd ads-dashboard-angular
npm install
ng serve
# http://localhost:4200
```

### C++ Setup (Für Production)
```bash
# 1. Repository klonen
git clone https://github.com/chilledflo/ADS-MQTT-Broker-C-.git
cd ADS-MQTT-Broker-C-

# 2. Build-Tools installieren (Windows)
# - Visual Studio 2022 mit C++ Desktop Development
# - CMake 3.20+
# - vcpkg (C:\vcpkg)

# 3. Dependencies installieren
vcpkg install paho-mqttpp3:x64-windows nlohmann-json:x64-windows spdlog:x64-windows

# 4. Build
mkdir build && cd build
cmake .. -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build . --config Release

# 5. Run
.\Release\ads-mqtt-broker.exe
```

---

**Version**: 3.0.0  
**Node.js**: ✅ Production Ready | **C++**: ⚙️ Beta  
**Last Updated**: November 2025
