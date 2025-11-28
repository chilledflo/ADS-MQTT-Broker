# ADS Client Integration Guide

Alle Mock-Implementierungen wurden aus dem Projekt entfernt. Um das System mit echten Beckhoff TwinCAT/ADS Geräten zu verbinden, folgen Sie dieser Anleitung:

## Voraussetzungen

1. **TwinCAT installiert** auf dem Zielgerät oder TwinCAT ADS Router
2. **Netzwerkverbindung** zum TwinCAT-System
3. **ADS Route** konfiguriert zwischen Broker und TwinCAT

## Installation des ADS Client

### Option 1: ads-client (empfohlen)

```bash
npm install ads-client
```

Dokumentation: https://github.com/jisotalo/ads-client

### Option 2: node-ads

```bash
npm install node-ads
```

## Integration in ads-gateway.ts

### 1. ADS Client Import

Fügen Sie am Anfang von `src/ads-gateway.ts` hinzu:

```typescript
import { Client } from 'ads-client';
```

### 2. Client Initialisierung in connect()

Ersetzen Sie die Kommentare in der `connect()` Methode:

```typescript
async connect(): Promise<void> {
  try {
    console.log(`[ADS Gateway] Connecting to ${this.adsHost}:${this.adsPort}`);
    
    const { Client } = require('ads-client');
    
    this.client = new Client({
      targetAmsNetId: `${this.adsTargetIp}.1.1`,
      targetAdsPort: this.adsTargetPort,
      bareClient: true  // Keine automatische Verbindung
    });

    await this.client.connect();
    
    this.connected = true;
    console.log(`[ADS Gateway] Connected successfully`);
    
    this.initializeSymbolDiscovery();
    this.emit('connected');
  } catch (error) {
    console.error('[ADS Gateway] Connection failed:', error);
    this.connected = false;
    this.emit('error', error);
  }
}
```

### 3. Variable lesen in readValue()

Ersetzen Sie die `readValue()` Methode:

```typescript
private async readValue(variable: AdsVariable): Promise<any> {
  if (!this.connected || !this.client) {
    throw new Error('ADS Gateway not connected');
  }

  try {
    // Lese Variable über Symbolnamen
    const result = await this.client.readSymbol(variable.path);
    return result.value;
  } catch (error) {
    console.error(`[ADS Gateway] Failed to read ${variable.path}:`, error);
    throw error;
  }
}
```

### 4. Variable schreiben (optional)

Fügen Sie eine neue Methode hinzu:

```typescript
async writeValue(variable: AdsVariable, value: any): Promise<void> {
  if (!this.connected || !this.client) {
    throw new Error('ADS Gateway not connected');
  }

  try {
    await this.client.writeSymbol(variable.path, value);
    console.log(`[ADS Gateway] Wrote ${value} to ${variable.path}`);
  } catch (error) {
    console.error(`[ADS Gateway] Failed to write ${variable.path}:`, error);
    throw error;
  }
}
```

## Integration in ads-symbol-discovery.ts

### Symbol-Version lesen

```typescript
private async readSymbolVersion(): Promise<number> {
  try {
    // Benötigt ADS Client Instanz - übergeben über Constructor
    const buffer = await this.adsClient.read({
      indexGroup: 0xF00F,
      indexOffset: 0x0000,
      length: 4
    });
    return buffer.readUInt32LE(0);
  } catch (error) {
    console.error('[Symbol Discovery] Failed to read symbol version:', error);
    throw error;
  }
}
```

### Symbol-Anzahl lesen

```typescript
private async readSymbolCount(): Promise<number> {
  try {
    const buffer = await this.adsClient.read({
      indexGroup: 0xF00F,
      indexOffset: 0x0004,
      length: 4
    });
    return buffer.readUInt32LE(0);
  } catch (error) {
    console.error('[Symbol Discovery] Failed to read symbol count:', error);
    throw error;
  }
}
```

### Symbol-Informationen lesen

```typescript
private async readSymbolInfo(index: number): Promise<PlcSymbol> {
  try {
    // 1. Lese Symbol-Entry Länge
    const lengthBuffer = await this.adsClient.read({
      indexGroup: 0xF00F,
      indexOffset: index,
      length: 4
    });
    const entryLength = lengthBuffer.readUInt32LE(0);

    // 2. Lese kompletten Symbol-Entry
    const entryBuffer = await this.adsClient.read({
      indexGroup: 0xF00F,
      indexOffset: index,
      length: entryLength
    });

    // 3. Parse Symbol-Informationen
    return this.parseSymbolEntry(entryBuffer);
  } catch (error) {
    console.error(`[Symbol Discovery] Failed to read symbol ${index}:`, error);
    throw error;
  }
}

private parseSymbolEntry(buffer: Buffer): PlcSymbol {
  let offset = 4; // Skip length
  
  const indexGroup = buffer.readUInt32LE(offset); offset += 4;
  const indexOffset = buffer.readUInt32LE(offset); offset += 4;
  const size = buffer.readUInt32LE(offset); offset += 4;
  const dataType = buffer.readUInt32LE(offset); offset += 4;
  const flags = buffer.readUInt16LE(offset); offset += 2;
  
  const nameLength = buffer.readUInt16LE(offset); offset += 2;
  const name = buffer.toString('utf8', offset, offset + nameLength - 1);
  offset += nameLength;
  
  const typeLength = buffer.readUInt16LE(offset); offset += 2;
  const typeName = buffer.toString('utf8', offset, offset + typeLength - 1);
  offset += typeLength;
  
  const commentLength = buffer.readUInt16LE(offset); offset += 2;
  const comment = commentLength > 0 
    ? buffer.toString('utf8', offset, offset + commentLength - 1)
    : undefined;

  return {
    name,
    indexGroup,
    indexOffset,
    size,
    dataType: typeName,
    comment,
    flags
  };
}
```

## ADS Client Instanz übergeben

Der Symbol Discovery Service benötigt Zugriff auf den ADS Client. Passen Sie den Constructor an:

```typescript
// In ads-symbol-discovery.ts
constructor(
  private connectionId: string,
  private config: SymbolDiscoveryConfig,
  private adsClient: any  // ADS Client Instanz
) {
  super();
}

// In ads-gateway.ts beim Erstellen
this.symbolDiscovery = new AdsSymbolDiscovery(
  connectionId, 
  config,
  this.client  // ADS Client übergeben
);
```

## ADS Route Konfiguration

### TwinCAT Router konfigurieren

1. TwinCAT System Manager öffnen
2. Router → Edit Routes
3. Add Route für den Broker-PC:
   - Name: `MQTT-Broker`
   - AmsNetId: `<IP des Broker-PCs>.1.1`
   - Transport Type: `TCP/IP`
   - Address: `<IP des Broker-PCs>`

### Firewall-Einstellungen

Öffnen Sie folgende Ports:

- **TCP 48898** - ADS Router Port
- **TCP 801** - TwinCAT 2 Runtime Port  
- **TCP 851** - TwinCAT 3 Runtime Port

## Test der Verbindung

```typescript
// Test-Script: test-ads-connection.ts
import { Client } from 'ads-client';

async function testConnection() {
  const client = new Client({
    targetAmsNetId: '192.168.3.42.1.1',
    targetAdsPort: 851
  });

  try {
    await client.connect();
    console.log('✅ Connected to TwinCAT');
    
    const deviceInfo = await client.readDeviceInfo();
    console.log('Device Info:', deviceInfo);
    
    await client.disconnect();
  } catch (error) {
    console.error('❌ Connection failed:', error);
  }
}

testConnection();
```

## Troubleshooting

### Fehler: "No route to host"

- Prüfen Sie die ADS Route auf dem TwinCAT-System
- Firewall-Einstellungen überprüfen
- Ping-Test zum Zielsystem

### Fehler: "Target port not found"

- Falscher ADS Port (801 für TC2, 851 für TC3, 48898 für System Service)
- TwinCAT Runtime läuft nicht

### Fehler: "Connection timeout"

- Netzwerkverbindung unterbrochen
- ADS Router läuft nicht
- Falsche IP-Adresse

## Performance-Tuning

### Optimale Poll-Intervalle

```typescript
const config: SymbolDiscoveryConfig = {
  autoDiscovery: true,
  discoveryInterval: 10000,  // 10 Sekunden für OnlineChange Check
  autoAddVariables: true,
  defaultPollInterval: 100,  // 100ms für kritische Variablen
  symbolFilter: /^GVL\./     // Nur GVL-Variablen
};
```

### Batch-Reads verwenden

Für bessere Performance mehrere Variablen in einem Request lesen:

```typescript
const handles = await client.createVariableHandleMulti([
  'GVL.Motor.Speed',
  'GVL.Motor.Current',
  'GVL.Sensor.Temperature'
]);

const values = await client.readMulti(handles);
```

## Weitere Ressourcen

- [ads-client Documentation](https://github.com/jisotalo/ads-client)
- [TwinCAT ADS Protocol](https://infosys.beckhoff.com/english.php?content=../content/1033/tc3_ads_intro/index.html)
- [Beckhoff Information System](https://infosys.beckhoff.com/)
