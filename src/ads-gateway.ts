import { EventEmitter } from 'events';
import { Client } from 'ads-client';

export interface AdsVariable {
  id: string;
  name: string;
  path: string;
  type: 'BOOL' | 'BYTE' | 'WORD' | 'DWORD' | 'INT' | 'DINT' | 'REAL' | 'LREAL' | 'STRING';
  pollInterval: number; // ms - nur für Fallback, sonst Notification
  mqttTopic: string;
  value?: any;
  timestamp?: number;
  lastUpdate?: string; // ISO timestamp of last read
  updateRate?: number; // microseconds of last read operation
  error?: string;
  useNotification?: boolean; // true = Echtzeit via ADS Notification (<1ms)
}

interface AdsHandle {
  handle: number;
  variable: AdsVariable;
  lastValue?: any;
  pollTimer?: NodeJS.Timeout;
  notificationHandle?: any; // ADS Notification Handle für Echtzeit (ActiveSubscription)
  useNotification?: boolean; // true = Event-basiert, false = Polling
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
  private client: Client | null = null;
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
      console.log(
        `[ADS Gateway] Connecting to ${this.adsHost}:${this.adsPort}`
      );
      console.log(`[ADS Gateway] Target: ${this.adsTargetIp}:${this.adsTargetPort}`);

      // Echte ADS-Verbindung aufbauen
      this.client = new Client({
        targetAmsNetId: `${this.adsTargetIp}.1.1`,
        targetAdsPort: this.adsTargetPort,
        localAmsNetId: '', // wird automatisch ermittelt
        localAdsPort: this.adsSourcePort,
        rawClient: false // Verwende symbolischen Zugriff
      });

      await this.client.connect();

      this.connected = true;
      console.log(`[ADS Gateway] Connected successfully`);
      
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
      // Try to read the variable once to verify it exists and measure read time
      const startTime = process.hrtime.bigint();
      const value = await this.readValue(variable, false); // Don't create sub-vars yet
      const endTime = process.hrtime.bigint();
      const durationMicros = Number(endTime - startTime) / 1000; // Convert nanoseconds to microseconds
      
      variable.value = value;
      variable.timestamp = Date.now();
      variable.lastUpdate = new Date().toISOString();
      variable.updateRate = durationMicros;

      // Now create sub-variables with correct timing inherited from parent
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.createVirtualSubVariables(variable, value);
      }

      // Standardmäßig ADS Notification für Echtzeit aktivieren
      const useNotification = variable.useNotification !== false; // Default: true

      // Create handle for polling/notification
      const handle: AdsHandle = {
        handle: this.handles.size,
        variable,
        lastValue: value,
        useNotification,
      };

      this.handles.set(variable.id, handle);

      // Start polling or notification
      await this.startPolling(variable.id);

      const mode = useNotification ? '⚡ REALTIME' : '⏱️ POLLING';
      console.log(`[ADS Gateway] Added variable: ${variable.name} (${variable.path}) - ${mode}`);
      this.emit('variable-added', variable);
    } catch (error) {
      console.error(`[ADS Gateway] Failed to add variable ${variable.name}:`, error);
      throw error;
    }
  }

  async removeVariable(variableId: string): Promise<void> {
    const handle = this.handles.get(variableId);
    if (handle) {
      // Stoppe Polling wenn aktiv
      if (handle.pollTimer) {
        clearInterval(handle.pollTimer);
      }
      // Stoppe ADS Notification wenn aktiv
      if (handle.notificationHandle && this.client) {
        try {
          await this.client.unsubscribe(handle.notificationHandle);
          console.log(`[ADS Gateway] ⚡ Stopped realtime notification for ${variableId}`);
        } catch (error) {
          console.error(`[ADS Gateway] Failed to unsubscribe notification:`, error);
        }
      }
    }
    this.handles.delete(variableId);
    console.log(`[ADS Gateway] Removed variable: ${variableId}`);
  }

  private async startPolling(variableId: string): Promise<void> {
    const handle = this.handles.get(variableId);
    if (!handle) return;

    // Prüfe ob Echtzeit-Modus (ADS Notification) gewünscht ist
    if (handle.useNotification && this.client) {
      try {
        // ADS Device Notification für deterministische Echtzeit <1ms
        console.log(`[ADS Gateway] ⚡ Starting REALTIME notification for ${handle.variable.name}`);
        
        const notificationHandle = await this.client.subscribe({
          target: handle.variable.path,
          cycleTime: 1, // 1ms - MAXIMALE Geschwindigkeit
          callback: (data: any) => {
            try {
              const startTime = process.hrtime.bigint();
              const value = data.value;
              const endTime = process.hrtime.bigint();
              const durationMicros = Number(endTime - startTime) / 1000;

              handle.variable.lastUpdate = new Date().toISOString();
              handle.variable.updateRate = durationMicros;
              handle.lastValue = value;
              handle.variable.value = value;
              handle.variable.timestamp = Date.now();
              handle.variable.error = undefined;

              // Struct-Handling
              if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                this.createVirtualSubVariables(handle.variable, value);
              }

              // IMMER emiten für maximale Geschwindigkeit (kein Change-Check)
              this.emit('variable-changed', handle.variable);
            } catch (error: any) {
              console.error(`[ADS Gateway] Notification error for ${handle.variable.name}:`, error);
            }
          }
        });

        handle.notificationHandle = notificationHandle;
        console.log(`[ADS Gateway] ✓ Realtime notification active for ${handle.variable.name}`);
        return;
      } catch (error) {
        console.warn(`[ADS Gateway] Notification failed for ${handle.variable.name}, falling back to polling:`, error);
        // Fallback zu Polling
      }
    }

    // Ultra-schnelles Polling (Fallback wenn Notification nicht verfügbar)
    const poll = async () => {
      try {
        const startTime = process.hrtime.bigint();
        const value = await this.readValue(handle.variable, false);
        const endTime = process.hrtime.bigint();
        const durationMicros = Number(endTime - startTime) / 1000;

        handle.variable.lastUpdate = new Date().toISOString();
        handle.variable.updateRate = durationMicros;
        handle.lastValue = value;
        handle.variable.value = value;
        handle.variable.timestamp = Date.now();
        handle.variable.error = undefined;

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          this.createVirtualSubVariables(handle.variable, value);
        }

        // IMMER emiten (kein Change-Check für maximale Geschwindigkeit)
        this.emit('variable-changed', handle.variable);
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
    poll();
  }

  private async readValue(variable: AdsVariable, createSubVars: boolean = false): Promise<any> {
    if (!this.connected) {
      throw new Error('ADS Gateway not connected');
    }

    if (!this.client) {
      throw new Error('ADS Client not initialized');
    }

    try {
      // Echte ADS-Read Implementierung mit ads-client
      const result = await this.client.readValue(variable.path);
      
      // Create sub-variables if requested (after timing has been set on parent)
      if (createSubVars && result.value && typeof result.value === 'object' && !Array.isArray(result.value)) {
        this.createVirtualSubVariables(variable, result.value);
      }
      
      return result.value;
    } catch (error) {
      console.error(`[ADS Gateway] Failed to read ${variable.path}:`, error);
      throw error;
    }
  }

  /**
   * Erstellt virtuelle Sub-Variablen für Struct-Felder
   * Diese werden automatisch als separate Variablen hinzugefügt und im Tree angezeigt
   */
  private createVirtualSubVariables(parentVariable: AdsVariable, structValue: Record<string, any>): void {
    const fields = Object.keys(structValue);
    
    for (const fieldName of fields) {
      let fieldValue = structValue[fieldName];
      
      // BigInt zu Number konvertieren für JSON-Kompatibilität
      if (typeof fieldValue === 'bigint') {
        fieldValue = Number(fieldValue);
      }
      
      const subVarId = `${parentVariable.id}_${fieldName}`;
      const subVarPath = `${parentVariable.path}.${fieldName}`;
      
      // Prüfe ob Sub-Variable bereits existiert
      if (this.handles.has(subVarId)) {
        // Aktualisiere Wert UND Timing vom Parent
        const handle = this.handles.get(subVarId)!;
        if (handle.variable.value !== fieldValue) {
          handle.variable.value = fieldValue;
          handle.variable.timestamp = Date.now();
          handle.lastValue = fieldValue;
          this.emit('variable-changed', handle.variable);
        }
        // Timing-Werte vom Parent übernehmen
        handle.variable.lastUpdate = parentVariable.lastUpdate;
        handle.variable.updateRate = parentVariable.updateRate;
      } else {
        // Erstelle neue virtuelle Sub-Variable mit Timing vom Parent
        const subVariable: AdsVariable = {
          id: subVarId,
          name: subVarPath,
          path: subVarPath,
          type: this.guessTypeFromValue(fieldValue),
          pollInterval: parentVariable.pollInterval,
          mqttTopic: `${parentVariable.mqttTopic}/${fieldName}`,
          value: fieldValue,
          timestamp: Date.now(),
          lastUpdate: parentVariable.lastUpdate,
          updateRate: parentVariable.updateRate
        };
        
        const handle: AdsHandle = {
          handle: this.handles.size,
          variable: subVariable,
          lastValue: fieldValue,
        };
        
        this.handles.set(subVarId, handle);
        
        try {
          const valueStr = typeof fieldValue === 'object' ? JSON.stringify(fieldValue) : String(fieldValue);
          console.log(`[ADS Gateway] ✓ Created virtual sub-variable: ${subVarPath} = ${valueStr}`);
        } catch (e) {
          console.log(`[ADS Gateway] ✓ Created virtual sub-variable: ${subVarPath} = [complex value]`);
        }
        
        this.emit('variable-added', subVariable);
        
        // Rekursiv für verschachtelte Structs
        if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
          this.createVirtualSubVariables(subVariable, fieldValue);
        }
      }
    }
  }

  /**
   * Errät den Datentyp basierend auf dem JavaScript-Wert
   */
  private guessTypeFromValue(value: any): AdsVariable['type'] {
    if (typeof value === 'boolean') return 'BOOL';
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        if (value >= -32768 && value <= 32767) return 'INT';
        return 'DINT';
      }
      return 'REAL';
    }
    if (typeof value === 'string') return 'STRING';
    return 'DWORD'; // Fallback
  }

  async writeValue(variablePath: string, value: any): Promise<void> {
    if (!this.connected) {
      throw new Error('ADS Gateway not connected');
    }

    if (!this.client) {
      throw new Error('ADS Client not initialized');
    }

    try {
      await this.client.writeValue(variablePath, value);
      console.log(`[ADS Gateway] Wrote ${value} to ${variablePath}`);
    } catch (error) {
      console.error(`[ADS Gateway] Failed to write ${variablePath}:`, error);
      throw error;
    }
  }

  getVariable(variableId: string): AdsVariable | undefined {
    const handle = this.handles.get(variableId);
    return handle?.variable;
  }

  getAllVariables(): AdsVariable[] {
    return Array.from(this.handles.values()).map((h) => h.variable);
  }

  getClient(): Client | null {
    return this.client;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
