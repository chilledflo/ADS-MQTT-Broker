# ADS-MQTT Broker v4.0 - Build Notes

## Bekannte Limitations in v4.0 Initial Release

Aufgrund von TypeScript-Kompatibilitäts-Problemen zwischen v3.0 und v4.0 Code wurden einige Adapter-Patterns verwendet:

### 1. AdsManagerV4Adapter
Der `AdsManagerV4Adapter` erweitert den v3.0 `AdsConnectionManager` mit zusätzlichen Methoden:
- `writeVariable()` - Variable schreiben
- `getConnectionStatuses()` - Alle Connection Status
- `getAllVariables()` - Alle Variablen abrufen
- `getSymbols()` - Symbols für Connection
- `updateVariable()` - Variable aktualisieren

### 2. MQTT Broker Limitations
Die `getClientCount()` Methode existiert noch nicht im MqttBroker. Vorübergehende Lösung:
- Nutze alternative Metriken
- Wird in v4.1 implementiert

### 3. Variable Creation
Die `addVariable()` Methode erwartet vollständige `AdsVariable` Objekte. Bei REST API Calls müssen ID und mqttTopic generiert werden.

## Workaround für Development

Wenn Build-Fehler auftreten:

```bash
# Option 1: v3.0 weiter nutzen
npm run dev:v3

# Option 2: TypeScript strict mode deaktivieren (tsconfig.json)
"strict": false

# Option 3: v4.0 Komponenten einzeln testen
ts-node src/event-bus.ts
ts-node src/redis-cache.ts
ts-node benchmark-v4.ts
```

## Production Deployment Empfehlung

Für Production wird empfohlen:
1. v3.0 stable version nutzen: `npm run start:v3`
2. v4.0 Features separat testen
3. Nach vollständiger Integration auf v4.0 upgraden

## v4.1 Roadmap

- [ ] Vollständige Integration der Adapter
- [ ] MqttBroker.getClientCount() implementieren
- [ ] AdsVariable Factory Pattern
- [ ] Unified Type System
- [ ] Integration Tests
- [ ] Performance Benchmarks im CI/CD

