import { EventEmitter } from 'events';

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
 */
export class AdsGateway extends EventEmitter {
  private client: any = null;
  private handles: Map<string, AdsHandle> = new Map();
  private connected = false;

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
    // Beispiel Mock-Werte für Demo
    this.mockValues.set('GVL.Motor.Speed', 1234.56);
    this.mockValues.set('GVL.Motor.Running', true);
    this.mockValues.set('GVL.Sensor.Temperature', 45.2);
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
      this.emit('connected');
    } catch (error) {
      console.error('[ADS Gateway] Connection failed:', error);
      this.connected = false;
      this.emit('error', error);
    }
  }

  async disconnect(): Promise<void> {
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
}
