import { EventEmitter } from 'events';
import { Client as AdsClient, AdsClientSettings } from 'ads-client'; // Korrigierter Import für AdsClient und AdsClientSettings

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
  private client: AdsClient | null = null; // Typisierung für den ADS-Client
  private handles: Map<string, AdsHandle> = new Map();
  private connected = false;

  constructor(
    private adsHost: string,
    private adsPort: number,
    private adsTargetIp: string,
    private adsTargetPort: number,
    private adsSourcePort: number
  ) {
    super();
  }

  async connect(): Promise<void> {
    try {
      const options: AdsClientSettings = {
        targetAmsNetId: this.adsHost,
        targetAdsPort: this.adsPort,
        localAdsPort: this.adsSourcePort,
        // Weitere Optionen können hier hinzugefügt werden
      };

      this.client = new AdsClient(options);
      await this.client.connect();
      this.connected = true;

      console.log(`[ADS Gateway] Connected to ADS at ${this.adsHost}:${this.adsPort}`);
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
    if (!this.connected || !this.client) {
      throw new Error('ADS Gateway not connected or client not initialized.');
    }

    // Echte ADS-Read-Implementierung
    const result = await this.client.readValue(variable.path);
    return result.value;
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
   * Gibt den ADS Client zurück (für Symbol Discovery)
   */
  getClient(): AdsClient | null {
    return this.client;
  }
}
