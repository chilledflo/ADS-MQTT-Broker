import { EventEmitter } from 'events';
import { AdsSymbolDiscovery, SymbolDiscoveryConfig } from './ads-symbol-discovery';

export interface AdsVariable {
  id: string;
  name: string;
  path: string;
  type: 'BOOL' | 'BYTE' | 'WORD' | 'DWORD' | 'INT' | 'DINT' | 'REAL' | 'LREAL' | 'STRING';
  pollInterval: number; // ms
  mqttTopic: string;
  value?: any;
  timestamp?: number;
  error?: string;
}

interface AdsHandle {
  handle: number;
  variable: AdsVariable;
  lastValue?: any;
  pollTimer?: NodeJS.Timeout;
}

/**
 * ADS Gateway - verbindet mit Beckhoff TwinCAT Systemen
 * 
 * Diese Implementierung unterstützt:
 * 1. Direktes Polling von Variablen über HTTP
 * 2. WebSocket-basierte Echtzeit-Updates
 * 3. Integration mit externen ADS-Clients via REST API
 * 4. Automatische Symbol-Erkennung bei OnlineChange
 */
export class AdsGateway extends EventEmitter {
  private client: any = null;
  private handles: Map<string, AdsHandle> = new Map();
  private connected = false;
  private symbolDiscovery?: AdsSymbolDiscovery;

  // Mock-Werte für Demo/Testing
  private mockValues: Map<string, any> = new Map();

  constructor(
    private adsHost: string,
    private adsPort: number,
    private adsTargetIp: string,
    private adsTargetPort: number,
    private adsSourcePort: number
  ) {
    super();
    this.initializeMockValues();
  }

  private initializeMockValues(): void {
    // Beispiel Mock-Werte für Demo - ohne GVL Präfix
    this.mockValues.set('Motor.Speed', 1234.56);
    this.mockValues.set('Motor.Running', true);
    this.mockValues.set('Motor.Current', 12.5);
    this.mockValues.set('Sensor.Temperature', 45.2);
    this.mockValues.set('Sensor.Pressure', 2.5);
    this.mockValues.set('Sensor.Level', 75.8);
    this.mockValues.set('Valve.Position', 50.0);
    this.mockValues.set('Valve.Open', true);
    this.mockValues.set('Pump.Active', false);
    this.mockValues.set('Pump.FlowRate', 125.3);
    this.mockValues.set('ProductCount', 4567);
    this.mockValues.set('CycleTime', 2340);
    this.mockValues.set('ErrorCode', 0);
    this.mockValues.set('Warning', false);
    this.mockValues.set('SetPoint', 100.0);
  }

  async connect(): Promise<void> {
    try {
      // Versuche real mit ADS zu verbinden, fallback zu Mock bei Fehler
      console.log(
        `[ADS Gateway] Attempting connection to ${this.adsHost}:${this.adsPort}`
      );

      // TODO: Hier würde die echte ADS-Verbindung stattfinden
      // Für jetzt verwenden wir Mock-Werte
      this.connected = true;

      console.log(`[ADS Gateway] Ready (Mock Mode)`);
      console.log(`[ADS Gateway] Target: ${this.adsTargetIp}:${this.adsTargetPort}`);
      
      // Starte automatische Symbol-Erkennung
      this.initializeSymbolDiscovery();
      
      this.emit('connected');
    } catch (error) {
      console.error('[ADS Gateway] Connection failed:', error);
      this.connected = false;
      this.emit('error', error);
    }
  }

  /**
   * Initialisiert die automatische Symbol-Erkennung
   */
  private initializeSymbolDiscovery(): void {
    const config: SymbolDiscoveryConfig = {
      autoDiscovery: true,
      discoveryInterval: 5000, // Prüfe alle 5 Sekunden auf OnlineChange
      autoAddVariables: true,
      defaultPollInterval: 1000, // 1 Sekunde Standard-Polling
      symbolFilter: undefined // Alle Symbole (kann später gefiltert werden)
    };

    const connectionId = `${this.adsTargetIp}:${this.adsTargetPort}`;
    this.symbolDiscovery = new AdsSymbolDiscovery(connectionId, config);

    // Event Handler für Symbol-Discovery
    this.symbolDiscovery.on('online-change-detected', (data) => {
      console.log(`[ADS Gateway] OnlineChange detected: Version ${data.version}, ${data.symbolCount} symbols`);
      this.emit('online-change-detected', data);
    });

    this.symbolDiscovery.on('symbols-discovered', (data) => {
      console.log(`[ADS Gateway] Symbols discovered: ${data.filtered} of ${data.total} symbols`);
      this.emit('symbols-discovered', data);
    });

    this.symbolDiscovery.on('variables-discovered', async (data) => {
      console.log(`[ADS Gateway] Auto-adding ${data.variables.length} variables`);
      
      // Automatisch gefundene Variablen hinzufügen
      for (const variable of data.variables) {
        try {
          await this.addVariable(variable);
          console.log(`[ADS Gateway] Auto-added variable: ${variable.name}`);
        } catch (error) {
          console.error(`[ADS Gateway] Failed to auto-add variable ${variable.name}:`, error);
        }
      }

      this.emit('variables-auto-added', data);
    });

    this.symbolDiscovery.on('discovery-error', (data) => {
      console.error(`[ADS Gateway] Symbol discovery error:`, data.error);
      this.emit('discovery-error', data);
    });

    // Starte Symbol-Erkennung
    this.symbolDiscovery.start();
    console.log('[ADS Gateway] Symbol discovery started');
  }

  async disconnect(): Promise<void> {
    // Stoppe Symbol-Erkennung
    if (this.symbolDiscovery) {
      this.symbolDiscovery.stop();
      this.symbolDiscovery = undefined;
    }

    this.handles.forEach((handle) => {
      if (handle.pollTimer) {
        clearInterval(handle.pollTimer);
      }
    });

    if (this.client) {
      this.client.disconnect();
      this.connected = false;
      console.log('[ADS Gateway] Disconnected');
    }
  }

  async addVariable(variable: AdsVariable): Promise<void> {
    if (!this.connected) {
      throw new Error('ADS Gateway not connected');
    }

    try {
      // Try to read the variable once to verify it exists
      const value = await this.readValue(variable);
      variable.value = value;
      variable.timestamp = Date.now();

      // Create handle for polling
      const handle: AdsHandle = {
        handle: this.handles.size,
        variable,
        lastValue: value,
      };

      this.handles.set(variable.id, handle);

      // Start polling
      this.startPolling(variable.id);

      console.log(`[ADS Gateway] Added variable: ${variable.name} (${variable.path})`);
      this.emit('variable-added', variable);
    } catch (error) {
      console.error(`[ADS Gateway] Failed to add variable ${variable.name}:`, error);
      throw error;
    }
  }

  async removeVariable(variableId: string): Promise<void> {
    const handle = this.handles.get(variableId);
    if (handle && handle.pollTimer) {
      clearInterval(handle.pollTimer);
    }
    this.handles.delete(variableId);
    console.log(`[ADS Gateway] Removed variable: ${variableId}`);
  }

  private startPolling(variableId: string): void {
    const handle = this.handles.get(variableId);
    if (!handle) return;

    const poll = async () => {
      try {
        const value = await this.readValue(handle.variable);

        if (value !== handle.lastValue) {
          handle.lastValue = value;
          handle.variable.value = value;
          handle.variable.timestamp = Date.now();
          handle.variable.error = undefined;

          this.emit('variable-changed', handle.variable);
        }
      } catch (error: any) {
        handle.variable.error = String(error);
        this.emit('variable-error', {
          variableId,
          error: String(error),
          timestamp: Date.now(),
        });
      }
    };

    handle.pollTimer = setInterval(poll, handle.variable.pollInterval);

    // Poll immediately
    poll();
  }

  private async readValue(variable: AdsVariable): Promise<any> {
    if (!this.connected) {
      throw new Error('ADS Gateway not connected');
    }

    // Mock-Implementation für Demo
    // In Production würde hier der echte ADS-Read stattfinden
    const mockedValue = this.mockValues.get(variable.path);

    if (mockedValue !== undefined) {
      // Simuliere kleine Schwankungen für realistische Daten
      if (typeof mockedValue === 'number' && Math.random() < 0.3) {
        const variation = (Math.random() - 0.5) * 0.1;
        return mockedValue + variation;
      }
      return mockedValue;
    }

    // Für unbekannte Variablen Fehler werfen
    throw new Error(`Variable not found: ${variable.path}`);
  }

  getVariable(variableId: string): AdsVariable | undefined {
    const handle = this.handles.get(variableId);
    return handle?.variable;
  }

  getAllVariables(): AdsVariable[] {
    return Array.from(this.handles.values()).map((h) => h.variable);
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Gibt die Symbol-Discovery-Instanz zurück
   */
  getSymbolDiscovery(): AdsSymbolDiscovery | undefined {
    return this.symbolDiscovery;
  }

  /**
   * Löst manuell eine Symbol-Discovery aus
   */
  async triggerSymbolDiscovery(): Promise<void> {
    if (!this.symbolDiscovery) {
      throw new Error('Symbol discovery not initialized');
    }

    await this.symbolDiscovery.triggerDiscovery();
  }
}
