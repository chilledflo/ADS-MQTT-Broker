# TwinCAT Route Handling - DLL Dokumentation

## Übersicht

Die Verwaltung von TwinCAT-Routen wird durch verschiedene DLLs (Dynamic Link Libraries) von Beckhoff gehandhabt, abhängig von der TwinCAT-Version und dem Betriebssystem.

## Welche DLL handhabt TwinCAT-Routen?

### Windows-Systeme mit TwinCAT

#### TwinCAT 2
- **DLL**: `TcAdsDll.dll`
- **Pfad**: `C:\TwinCAT\AdsApi\TcAdsDll\Win32\TcAdsDll.dll` (32-bit) oder `Win64` (64-bit)
- **Funktion**: Verwaltet ADS-Kommunikation und Routing

#### TwinCAT 3
- **DLL**: `TcAdsDll2.dll`
- **Pfad**: `C:\TwinCAT\3.1\` (verschiedene Unterverzeichnisse je nach Installation)
- **Funktion**: Erweiterte ADS-Kommunikation und Routing mit verbesserter Performance
- **Dokumentation**: [Beckhoff InfoSys - TcAdsDll2](https://infosys.beckhoff.com/english.php?content=../content/1033/tc3_adsdll2/9007199379576075.html)

### Wichtige DLL-Funktionen

Die TcAdsDll/TcAdsDll2 bietet folgende Kernfunktionalitäten:

1. **Route-Management**
   - Hinzufügen von statischen Routen
   - Entfernen von Routen
   - Auflisten verfügbarer Routen
   - Route-Status-Überprüfung

2. **ADS-Kommunikation**
   - Read/Write von Variablen
   - Notification-Handling
   - Symbol-Informationen abrufen
   - RPC-Aufrufe

3. **Verbindungsverwaltung**
   - Port-Verwaltung
   - AmsNetId-Auflösung
   - Timeout-Handling

## Route-Verwaltung in verschiedenen Szenarien

### 1. Windows mit TwinCAT Router

**Komponente**: TwinCAT Router Service (nutzt TcAdsDll2.dll)

- Der TwinCAT Router läuft als Windows-Service
- Verwaltet alle lokalen und Remote-Routen
- Routen werden in `TcAmsRemoteMgr.exe` konfiguriert
- Persistente Routen in `C:\TwinCAT\3.1\Target\StaticRoutes.xml`

**In diesem Projekt**:
```typescript
// Die ads-client Library nutzt intern die TcAdsDll2.dll
import { Client as AdsClient } from 'ads-client';

const client = new AdsClient({
  targetAmsNetId: '192.168.1.100.1.1',
  targetAdsPort: 851
});
```

### 2. Linux/macOS ohne TwinCAT Router

**Komponente**: .NET-basierter ADS Router oder direkte Verbindung

#### Option A: ADS Router Console (Beckhoff)
- Verfügbar auf GitHub: [TF6000_ADS_DOTNET_V5_Samples](https://github.com/Beckhoff/TF6000_ADS_DOTNET_V5_Samples/tree/main/Sources/RouterSamples/AdsRouterConsoleApp)
- Plattformübergreifend (Windows/Linux/macOS)
- Emuliert TwinCAT Router-Funktionalität

#### Option B: Router-lose Verbindung
```typescript
// Direkte Verbindung über das TwinCAT Router des Zielsystems
const client = new AdsClient({
  targetAmsNetId: '192.168.1.100.1.1',
  targetAdsPort: 851,
  rawClient: true  // Nutzt Router des Zielsystems
});
```

**Anforderungen für Router-lose Verbindung**:
1. Statische Route auf dem Ziel-PLC erstellen
2. `StaticRoutes.xml` auf dem PLC bearbeiten:
   ```xml
   <RemoteConnections>
     <Route>
       <Name>NodeJS_Client</Name>
       <Address>192.168.1.50</Address>
       <NetId>192.168.1.50.1.1</NetId>
       <Type>TCP_IP</Type>
     </Route>
   </RemoteConnections>
   ```

### 3. Docker Container

Im Docker-Container wird keine DLL benötigt, da:
- Die Kommunikation über TCP/IP läuft
- Die `ads-client` Library die Protokoll-Implementierung in JavaScript/TypeScript enthält
- Nur Netzwerkverbindung zum TwinCAT-System erforderlich ist

## ADS-Client Library (npm Package)

Dieses Projekt nutzt das `ads-client` npm-Package, das:

1. **Keine Windows-DLLs benötigt**
   - Pure JavaScript/TypeScript-Implementierung des ADS-Protokolls
   - Funktioniert auf Windows, Linux, macOS, Docker

2. **Optional TcAdsDll2.dll nutzen kann**
   - Auf Windows-Systemen mit TwinCAT kann die native DLL für bessere Performance genutzt werden
   - Wird automatisch erkannt und verwendet, wenn verfügbar

3. **Route-Management**
   - Bei lokalem TwinCAT: Nutzt installierten Router (TcAdsDll2.dll)
   - Bei Remote-Verbindung: Direkte TCP/IP-Verbindung zum Ziel-Router
   - Keine manuelle Route-Konfiguration im Code erforderlich

## Technische Details

### ADS-Protokoll-Stack

```
┌─────────────────────────────────────┐
│   Node.js Application               │
│   (ADS-MQTT-Broker)                 │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   ads-client (npm package)          │
│   - JavaScript/TypeScript           │
│   - ADS Protocol Implementation     │
└──────────────┬──────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼─────┐  ┌──────▼──────────────┐
│ TCP/IP     │  │ TcAdsDll2.dll       │
│ (Linux/    │  │ (Windows optional)  │
│  Docker)   │  │                     │
└──────┬─────┘  └──────┬──────────────┘
       │                │
       └────────┬───────┘
                │
┌───────────────▼──────────────────────┐
│   TwinCAT ADS Router                 │
│   Port 48898                         │
└───────────────┬──────────────────────┘
                │
┌───────────────▼──────────────────────┐
│   TwinCAT Runtime                    │
│   Port 801/851                       │
└──────────────────────────────────────┘
```

### Port-Übersicht

| Port  | Verwendung                    | Komponente           |
|-------|-------------------------------|----------------------|
| 48898 | ADS Router                    | TcAmsRouter.exe      |
| 801   | TwinCAT 2 PLC Runtime         | TcRtsObjects.dll     |
| 851   | TwinCAT 3 PLC Runtime         | TcPlc3x.dll          |
| 10000 | System Service                | TcSystemManager.exe  |

## Route-Konfiguration für dieses Projekt

### Lokale Entwicklung (Windows mit TwinCAT)

1. **TwinCAT Router ist automatisch aktiv**
   ```bash
   # Prüfen ob Router läuft
   netstat -an | findstr 48898
   ```

2. **Localhost-Unterstützung aktivieren** (TwinCAT 3)
   - TwinCAT System tray icon rechtsklicken
   - "Router" → "Edit Routes..."
   - "Broadcast Search" aktivieren
   - Siehe: [Beckhoff InfoSys - Localhost Support](https://infosys.beckhoff.com/english.php?content=../content/1033/tc3_adsdll2/9007199379576075.html)

### Remote-Verbindung (Production)

1. **Auf dem ADS-MQTT-Broker-Server**:
   ```bash
   # Keine spezielle Konfiguration nötig
   # ads-client verbindet direkt über TCP/IP
   ```

2. **Auf dem TwinCAT-PLC**:
   - Route für Broker hinzufügen via `TcAmsRemoteMgr.exe`
   - Oder statische Route in `StaticRoutes.xml`:
     ```xml
     <Route>
       <Name>ADS_MQTT_Broker</Name>
       <Address>192.168.1.100</Address>
       <NetId>192.168.1.100.1.1</NetId>
       <Type>TCP_IP</Type>
     </Route>
     ```

### Docker Deployment

```yaml
# docker-compose.yml
services:
  ads-mqtt-broker:
    image: ads-mqtt-broker
    environment:
      - ADS_HOST=192.168.1.50.1.1  # Ziel-PLC AmsNetId
      - ADS_PORT=851                # TwinCAT 3 Runtime
    ports:
      - "1883:1883"  # MQTT
      - "8080:8080"  # REST API
```

**Wichtig**: Im Docker-Container wird keine DLL benötigt!

## Häufige Probleme und Lösungen

### Problem: "No route to target"

**Ursache**: Route nicht konfiguriert

**Lösung**:
1. Auf TwinCAT-System: Route für Client hinzufügen
2. Firewall-Regel für Port 48898 erstellen
3. AmsNetId korrekt konfigurieren

### Problem: "Target port not found"

**Ursache**: Falscher ADS-Port

**Lösung**:
- TwinCAT 2: Port 801
- TwinCAT 3: Port 851
- System Service: Port 10000

### Problem: Connection timeout

**Ursache**: TcAdsDll2.dll nicht gefunden (nur Windows)

**Lösung**:
1. TwinCAT installieren (enthält DLL)
2. Oder: Router-lose Verbindung nutzen
3. Oder: ADS Router Console verwenden

## Weiterführende Informationen

### Beckhoff Dokumentation
- [TcAdsDll2 Reference](https://infosys.beckhoff.com/english.php?content=../content/1033/tc3_adsdll2/9007199379576075.html)
- [ADS Protocol Specification](https://infosys.beckhoff.com/english.php?content=../content/1033/tcadscommon/html/tcadscommon_intro.htm)

### ads-client Library
- [GitHub Repository](https://github.com/jisotalo/ads-client)
- [NPM Package](https://www.npmjs.com/package/ads-client)
- [Dokumentation](https://jisotalo.fi/ads-client/)

### TwinCAT Router
- [ADS Router Console (.NET)](https://github.com/Beckhoff/TF6000_ADS_DOTNET_V5_Samples/tree/main/Sources/RouterSamples/AdsRouterConsoleApp)
- Plattformübergreifende Alternative zu TcAdsDll2.dll

## Zusammenfassung

**Kurze Antwort**: Die TwinCAT-Route wird auf Windows-Systemen durch **TcAdsDll2.dll** (TwinCAT 3) bzw. **TcAdsDll.dll** (TwinCAT 2) gehandhabt.

**In diesem Projekt**: Die `ads-client` Library abstrahiert die DLL-Nutzung und ermöglicht plattformübergreifende Kommunikation ohne direkte DLL-Abhängigkeit. Auf Windows wird die DLL optional genutzt, auf anderen Systemen erfolgt die Kommunikation rein über TCP/IP.

---

**Erstellt**: 2025-11-20  
**Version**: 1.0  
**Für**: ADS-MQTT-Broker v3.0.0
