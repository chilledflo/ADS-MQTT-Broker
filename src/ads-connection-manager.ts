import { EventEmitter } from 'events';
import { AdsGateway, AdsVariable } from './ads-gateway';
import { AdsSymbolDiscovery, SymbolDiscoveryConfig, PlcSymbol } from './ads-symbol-discovery';

export interface AdsConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  targetIp: string;
  targetPort: number;
  sourcePort: number;
  enabled: boolean;
  description?: string;
  symbolDiscovery?: SymbolDiscoveryConfig;
}

export interface ConnectionStatus {
  id: string;
  name: string;
  connected: boolean;
  variableCount: number;
  symbolCount?: number;
  autoDiscovery?: boolean;
  lastError?: string;
  lastConnected?: number;
}

/**
 * ADS Connection Manager - verwaltet mehrere ADS-Verbindungen
 *
 * Ermöglicht die gleichzeitige Verbindung zu mehreren TwinCAT-Systemen:
 * - Verschiedene PLCs im Netzwerk
 * - Mehrere Runtimes auf demselben System
 * - Parallele Datenerfassung von verschiedenen Quellen
 * - Automatische Symbol-Erkennung und OnlineChange-Detection
 */
export class AdsConnectionManager extends EventEmitter {
  private connections: Map<string, AdsGateway> = new Map();
  private configs: Map<string, AdsConnectionConfig> = new Map();
  private symbolDiscoveries: Map<string, AdsSymbolDiscovery> = new Map();
  private variableToConnection: Map<string, string> = new Map(); // variableId -> connectionId

  constructor() {
    super();
  }

  /**
   * Fügt eine neue ADS-Verbindung hinzu
   */
  async addConnection(config: AdsConnectionConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      throw new Error(`Connection with id ${config.id} already exists`);
    }

    this.configs.set(config.id, config);

    const gateway = new AdsGateway(
      config.host,
      config.port,
      config.targetIp,
      config.targetPort,
      config.sourcePort
    );

    // Forward events from gateway
    gateway.on('connected', () => {
      this.emit('connection-established', { connectionId: config.id, name: config.name });

      // Starte Symbol Discovery nach erfolgreicher Verbindung
      const discovery = this.symbolDiscoveries.get(config.id);
      if (discovery) {
        discovery.start();
      }
    });

    gateway.on('error', (error) => {
      this.emit('connection-error', { connectionId: config.id, name: config.name, error });
    });

    gateway.on('variable-changed', (variable: AdsVariable) => {
      this.emit('variable-changed', { connectionId: config.id, variable });
    });

    gateway.on('variable-error', (data) => {
      this.emit('variable-error', { connectionId: config.id, ...data });
    });

    this.connections.set(config.id, gateway);

    // Setup Symbol Discovery wenn konfiguriert
    if (config.symbolDiscovery) {
      const discovery = new AdsSymbolDiscovery(config.id, config.symbolDiscovery);

      // Forward Symbol Discovery events
      discovery.on('online-change-detected', (data) => {
        console.log(`[ADS Manager] OnlineChange detected on ${config.name}`);
        this.emit('online-change-detected', data);
      });

      discovery.on('symbols-discovered', (data) => {
        console.log(`[ADS Manager] Discovered ${data.filtered} symbols on ${config.name}`);
        this.emit('symbols-discovered', data);
      });

      discovery.on('variables-discovered', async (data) => {
        console.log(`[ADS Manager] Auto-adding ${data.variables.length} variables on ${config.name}`);

        // Automatisch Variablen hinzufügen
        for (const variable of data.variables) {
          try {
            await this.addVariable(config.id, variable);
          } catch (error) {
            console.error(`[ADS Manager] Failed to auto-add variable ${variable.name}:`, error);
          }
        }

        this.emit('variables-auto-added', data);
      });

      discovery.on('discovery-error', (data) => {
        console.error(`[ADS Manager] Symbol discovery error on ${config.name}:`, data.error);
        this.emit('discovery-error', data);
      });

      this.symbolDiscoveries.set(config.id, discovery);
    }

    if (config.enabled) {
      await this.connectConnection(config.id);
    }

    console.log(`[ADS Manager] Added connection: ${config.name} (${config.id})`);
  }

  /**
   * Entfernt eine ADS-Verbindung
   */
  async removeConnection(connectionId: string): Promise<void> {
    const gateway = this.connections.get(connectionId);
    if (gateway) {
      await gateway.disconnect();
      this.connections.delete(connectionId);
      this.configs.delete(connectionId);

      // Remove all variable mappings for this connection
      for (const [varId, connId] of this.variableToConnection.entries()) {
        if (connId === connectionId) {
          this.variableToConnection.delete(varId);
        }
      }

      console.log(`[ADS Manager] Removed connection: ${connectionId}`);
    }
  }

  /**
   * Verbindet eine spezifische ADS-Verbindung
   */
  async connectConnection(connectionId: string): Promise<void> {
    const gateway = this.connections.get(connectionId);
    if (!gateway) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    await gateway.connect();
  }

  /**
   * Trennt eine spezifische ADS-Verbindung
   */
  async disconnectConnection(connectionId: string): Promise<void> {
    const gateway = this.connections.get(connectionId);
    if (!gateway) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    await gateway.disconnect();
  }

  /**
   * Aktualisiert die Konfiguration einer Verbindung
   */
  async updateConnection(connectionId: string, config: Partial<AdsConnectionConfig>): Promise<void> {
    const existingConfig = this.configs.get(connectionId);
    if (!existingConfig) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const wasConnected = this.isConnectionConnected(connectionId);

    // Disconnect if connected
    if (wasConnected) {
      await this.disconnectConnection(connectionId);
    }

    // Update config
    const updatedConfig = { ...existingConfig, ...config };
    this.configs.set(connectionId, updatedConfig);

    // Remove old gateway
    this.connections.delete(connectionId);

    // Create new gateway with updated config
    await this.addConnection(updatedConfig);

    console.log(`[ADS Manager] Updated connection: ${connectionId}`);
  }

  /**
   * Fügt eine Variable zu einer spezifischen Verbindung hinzu
   */
  async addVariable(connectionId: string, variable: AdsVariable): Promise<void> {
    const gateway = this.connections.get(connectionId);
    if (!gateway) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    await gateway.addVariable(variable);
    this.variableToConnection.set(variable.id, connectionId);
  }

  /**
   * Entfernt eine Variable
   */
  async removeVariable(variableId: string): Promise<void> {
    const connectionId = this.variableToConnection.get(variableId);
    if (!connectionId) {
      throw new Error(`Variable ${variableId} not found`);
    }

    const gateway = this.connections.get(connectionId);
    if (gateway) {
      await gateway.removeVariable(variableId);
    }

    this.variableToConnection.delete(variableId);
  }

  /**
   * Gibt eine Variable zurück
   */
  getVariable(variableId: string): AdsVariable | undefined {
    const connectionId = this.variableToConnection.get(variableId);
    if (!connectionId) return undefined;

    const gateway = this.connections.get(connectionId);
    return gateway?.getVariable(variableId);
  }

  /**
   * Gibt alle Variablen zurück
   */
  getAllVariables(): AdsVariable[] {
    const allVariables: AdsVariable[] = [];

    for (const gateway of this.connections.values()) {
      allVariables.push(...gateway.getAllVariables());
    }

    return allVariables;
  }

  /**
   * Gibt alle Variablen einer spezifischen Verbindung zurück
   */
  getVariablesByConnection(connectionId: string): AdsVariable[] {
    const gateway = this.connections.get(connectionId);
    return gateway ? gateway.getAllVariables() : [];
  }

  /**
   * Gibt alle Verbindungen zurück
   */
  getAllConnections(): AdsConnectionConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Gibt eine spezifische Verbindung zurück
   */
  getConnection(connectionId: string): AdsConnectionConfig | undefined {
    return this.configs.get(connectionId);
  }

  /**
   * Gibt den Status aller Verbindungen zurück
   */
  getConnectionsStatus(): ConnectionStatus[] {
    const statuses: ConnectionStatus[] = [];

    for (const [id, config] of this.configs.entries()) {
      const gateway = this.connections.get(id);

      statuses.push({
        id,
        name: config.name,
        connected: gateway?.isConnected() || false,
        variableCount: gateway?.getAllVariables().length || 0,
      });
    }

    return statuses;
  }

  /**
   * Prüft ob eine Verbindung verbunden ist
   */
  isConnectionConnected(connectionId: string): boolean {
    const gateway = this.connections.get(connectionId);
    return gateway?.isConnected() || false;
  }

  /**
   * Gibt die Connection-ID für eine Variable zurück
   */
  getConnectionIdForVariable(variableId: string): string | undefined {
    return this.variableToConnection.get(variableId);
  }

  /**
   * Trennt alle Verbindungen
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    // Stoppe alle Symbol Discoveries
    for (const discovery of this.symbolDiscoveries.values()) {
      discovery.stop();
    }

    for (const [id, gateway] of this.connections.entries()) {
      promises.push(gateway.disconnect());
    }

    await Promise.all(promises);
    console.log('[ADS Manager] All connections disconnected');
  }

  /**
   * Gibt alle entdeckten Symbole einer Verbindung zurück
   */
  getDiscoveredSymbols(connectionId: string): PlcSymbol[] {
    const discovery = this.symbolDiscoveries.get(connectionId);
    return discovery ? discovery.getDiscoveredSymbols() : [];
  }

  /**
   * Triggert manuelle Symbol-Discovery für eine Verbindung
   */
  async triggerSymbolDiscovery(connectionId: string): Promise<PlcSymbol[]> {
    const discovery = this.symbolDiscoveries.get(connectionId);
    if (!discovery) {
      throw new Error(`No symbol discovery configured for connection ${connectionId}`);
    }

    return await discovery.triggerDiscovery();
  }

  /**
   * Aktualisiert die Symbol Discovery Konfiguration
   */
  updateSymbolDiscoveryConfig(connectionId: string, config: Partial<SymbolDiscoveryConfig>): void {
    const discovery = this.symbolDiscoveries.get(connectionId);
    if (!discovery) {
      throw new Error(`No symbol discovery configured for connection ${connectionId}`);
    }

    discovery.updateConfig(config);
  }

  /**
   * Prüft ob Symbol Discovery für eine Verbindung aktiv ist
   */
  isSymbolDiscoveryActive(connectionId: string): boolean {
    const discovery = this.symbolDiscoveries.get(connectionId);
    const config = this.configs.get(connectionId);
    return !!discovery && !!config?.symbolDiscovery?.autoDiscovery;
  }
}
