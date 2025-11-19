import { EventEmitter } from 'events';
import { AdsVariable } from './ads-gateway';

export interface PlcSymbol {
  name: string;
  indexGroup: number;
  indexOffset: number;
  size: number;
  dataType: string;
  comment?: string;
  flags: number;
}

export interface SymbolDiscoveryConfig {
  autoDiscovery: boolean;
  discoveryInterval: number; // ms - how often to check for OnlineChange
  autoAddVariables: boolean; // automatically add discovered variables
  symbolFilter?: RegExp; // regex to filter which symbols to discover
  defaultPollInterval: number; // default poll interval for discovered variables
}

/**
 * ADS Symbol Discovery Service
 *
 * Liest automatisch Symbole aus der SPS aus und erkennt OnlineChanges:
 * - Liest Symbol-Tabelle aus TwinCAT
 * - Erkennt wenn sich die SPS ändert (OnlineChange)
 * - Aktualisiert automatisch die Variable-Liste
 * - Ermöglicht Filterung nach Symbol-Namen
 */
export class AdsSymbolDiscovery extends EventEmitter {
  private symbols: Map<string, PlcSymbol> = new Map();
  private discoveryTimer?: NodeJS.Timeout;
  private lastSymbolVersion: number = 0;
  private isDiscovering: boolean = false;

  constructor(
    private connectionId: string,
    private config: SymbolDiscoveryConfig
  ) {
    super();
  }

  /**
   * Startet die automatische Symbol-Erkennung
   */
  start(): void {
    if (this.config.autoDiscovery) {
      console.log(`[Symbol Discovery] Starting for connection ${this.connectionId}`);
      this.startDiscoveryTimer();
    }
  }

  /**
   * Stoppt die automatische Symbol-Erkennung
   */
  stop(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
    console.log(`[Symbol Discovery] Stopped for connection ${this.connectionId}`);
  }

  /**
   * Startet den Discovery-Timer
   */
  private startDiscoveryTimer(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }

    this.discoveryTimer = setInterval(async () => {
      await this.checkForChanges();
    }, this.config.discoveryInterval);

    // Sofort initial ausführen
    this.checkForChanges();
  }

  /**
   * Prüft ob sich die Symbol-Tabelle geändert hat (OnlineChange)
   */
  private async checkForChanges(): Promise<void> {
    if (this.isDiscovering) {
      return; // Already discovering
    }

    try {
      this.isDiscovering = true;

      // Lese Symbol-Version (ändert sich bei OnlineChange)
      const currentVersion = await this.readSymbolVersion();

      if (currentVersion !== this.lastSymbolVersion) {
        console.log(`[Symbol Discovery] OnlineChange detected (version ${this.lastSymbolVersion} -> ${currentVersion})`);

        this.lastSymbolVersion = currentVersion;

        // Lese alle Symbole neu
        await this.discoverSymbols();

        this.emit('online-change-detected', {
          connectionId: this.connectionId,
          version: currentVersion,
          symbolCount: this.symbols.size
        });
      }
    } catch (error) {
      console.error('[Symbol Discovery] Error checking for changes:', error);
      this.emit('discovery-error', { connectionId: this.connectionId, error });
    } finally {
      this.isDiscovering = false;
    }
  }

  /**
   * Liest die Symbol-Version aus der SPS
   * Diese ändert sich bei jedem OnlineChange
   */
  private async readSymbolVersion(): Promise<number> {
    // TODO: Echte ADS-Implementierung
    // In TwinCAT ist die Symbol-Version in der Symbol-Tabelle Header gespeichert
    // IndexGroup: 0xF00F (61455), IndexOffset: 0x0000

    // Mock-Implementierung: Simuliert gelegentliche OnlineChanges
    if (Math.random() < 0.05) { // 5% Chance für OnlineChange
      return Date.now();
    }

    return this.lastSymbolVersion || 1;
  }

  /**
   * Liest alle Symbole aus der SPS
   */
  async discoverSymbols(): Promise<PlcSymbol[]> {
    console.log(`[Symbol Discovery] Discovering symbols for connection ${this.connectionId}`);

    try {
      // Lese Symbol-Anzahl
      const symbolCount = await this.readSymbolCount();

      console.log(`[Symbol Discovery] Found ${symbolCount} symbols`);

      const symbols: PlcSymbol[] = [];

      // Lese alle Symbol-Informationen
      for (let i = 0; i < symbolCount; i++) {
        const symbol = await this.readSymbolInfo(i);

        // Filter anwenden wenn konfiguriert
        if (this.config.symbolFilter && !this.config.symbolFilter.test(symbol.name)) {
          continue;
        }

        symbols.push(symbol);
        this.symbols.set(symbol.name, symbol);
      }

      console.log(`[Symbol Discovery] Discovered ${symbols.length} symbols (after filtering)`);

      // Event mit gefundenen Symbolen
      this.emit('symbols-discovered', {
        connectionId: this.connectionId,
        symbols: symbols,
        total: symbolCount,
        filtered: symbols.length
      });

      // Automatisch Variablen anlegen wenn konfiguriert
      if (this.config.autoAddVariables) {
        const variables = this.symbolsToVariables(symbols);
        this.emit('variables-discovered', {
          connectionId: this.connectionId,
          variables: variables
        });
      }

      return symbols;
    } catch (error) {
      console.error('[Symbol Discovery] Error discovering symbols:', error);
      throw error;
    }
  }

  /**
   * Liest die Anzahl der Symbole
   */
  private async readSymbolCount(): Promise<number> {
    // TODO: Echte ADS-Implementierung
    // IndexGroup: 0xF00F (61455), IndexOffset: 0x0000
    // Liest die Anzahl der verfügbaren Symbole

    // Mock-Implementierung mit realistischen Test-Symbolen
    return 15; // Simuliere 15 Symbole
  }

  /**
   * Liest Symbol-Informationen für einen Index
   */
  private async readSymbolInfo(index: number): Promise<PlcSymbol> {
    // TODO: Echte ADS-Implementierung
    // IndexGroup: 0xF00F, IndexOffset basierend auf Index

    // Mock-Implementierung mit realistischen Symbol-Namen
    const mockSymbols = [
      { name: 'GVL.Motor.Speed', dataType: 'REAL', comment: 'Motor speed in RPM' },
      { name: 'GVL.Motor.Running', dataType: 'BOOL', comment: 'Motor running status' },
      { name: 'GVL.Motor.Current', dataType: 'REAL', comment: 'Motor current in A' },
      { name: 'GVL.Sensor.Temperature', dataType: 'REAL', comment: 'Temperature sensor' },
      { name: 'GVL.Sensor.Pressure', dataType: 'REAL', comment: 'Pressure sensor' },
      { name: 'GVL.Sensor.Level', dataType: 'REAL', comment: 'Level sensor' },
      { name: 'GVL.Valve.Position', dataType: 'REAL', comment: 'Valve position %' },
      { name: 'GVL.Valve.Open', dataType: 'BOOL', comment: 'Valve open command' },
      { name: 'GVL.Pump.Active', dataType: 'BOOL', comment: 'Pump active' },
      { name: 'GVL.Pump.FlowRate', dataType: 'REAL', comment: 'Flow rate L/min' },
      { name: 'GVL.Counter.ProductCount', dataType: 'DINT', comment: 'Product counter' },
      { name: 'GVL.Counter.CycleTime', dataType: 'DINT', comment: 'Cycle time ms' },
      { name: 'GVL.Status.ErrorCode', dataType: 'WORD', comment: 'Error code' },
      { name: 'GVL.Status.Warning', dataType: 'BOOL', comment: 'Warning active' },
      { name: 'GVL.Config.SetPoint', dataType: 'REAL', comment: 'Setpoint value' },
    ];

    const mockData = mockSymbols[index % mockSymbols.length];

    return {
      name: mockData.name,
      indexGroup: 0x4020, // Data area
      indexOffset: index * 100,
      size: this.getDataTypeSize(mockData.dataType),
      dataType: mockData.dataType,
      comment: mockData.comment,
      flags: 0
    };
  }

  /**
   * Ermittelt die Größe eines Datentyps
   */
  private getDataTypeSize(dataType: string): number {
    const sizes: { [key: string]: number } = {
      'BOOL': 1,
      'BYTE': 1,
      'WORD': 2,
      'DWORD': 4,
      'INT': 2,
      'DINT': 4,
      'REAL': 4,
      'LREAL': 8,
      'STRING': 81
    };

    return sizes[dataType] || 4;
  }

  /**
   * Mappt PLC-Datentypen zu ADS-Variable Typen
   */
  private mapPlcTypeToAdsType(plcType: string): AdsVariable['type'] {
    const typeMap: { [key: string]: AdsVariable['type'] } = {
      'BOOL': 'BOOL',
      'BYTE': 'BYTE',
      'WORD': 'WORD',
      'DWORD': 'DWORD',
      'INT': 'INT',
      'DINT': 'DINT',
      'REAL': 'REAL',
      'LREAL': 'LREAL',
      'STRING': 'STRING'
    };

    return typeMap[plcType] || 'DWORD';
  }

  /**
   * Konvertiert PLC-Symbole zu ADS-Variablen
   */
  private symbolsToVariables(symbols: PlcSymbol[]): AdsVariable[] {
    return symbols.map(symbol => {
      const variable: AdsVariable = {
        id: `${this.connectionId}_${symbol.name.replace(/\./g, '_')}`,
        name: symbol.name,
        path: symbol.name,
        type: this.mapPlcTypeToAdsType(symbol.dataType),
        pollInterval: this.config.defaultPollInterval,
        mqttTopic: `ads/${this.connectionId}/${symbol.name.replace(/\./g, '/')}`
      };

      return variable;
    });
  }

  /**
   * Gibt alle entdeckten Symbole zurück
   */
  getDiscoveredSymbols(): PlcSymbol[] {
    return Array.from(this.symbols.values());
  }

  /**
   * Sucht ein Symbol nach Namen
   */
  findSymbol(name: string): PlcSymbol | undefined {
    return this.symbols.get(name);
  }

  /**
   * Manueller Trigger für Symbol-Discovery
   */
  async triggerDiscovery(): Promise<PlcSymbol[]> {
    return await this.discoverSymbols();
  }

  /**
   * Aktualisiert die Konfiguration
   */
  updateConfig(config: Partial<SymbolDiscoveryConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.config.autoDiscovery && !this.discoveryTimer) {
      this.start();
    } else if (!this.config.autoDiscovery && this.discoveryTimer) {
      this.stop();
    }
  }
}
