import { EventEmitter } from 'events';
import { Client as AdsClient, AdsSymbol } from 'ads-client'; // Korrigierter Import für AdsClient und AdsSymbol
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
  private allAdsSymbols: AdsSymbol[] = []; // Zum Speichern aller ADS-Symbole

  constructor(
    private connectionId: string,
    private config: SymbolDiscoveryConfig,
    private adsClient: AdsClient // ADS Client Instanz hinzufügen
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
    // Echte ADS-Implementierung: Symbol-Version aus der SPS lesen
    return await this.adsClient.readPlcSymbolVersion();
  }

  /**
   * Liest alle Symbole aus der SPS
   */
  async discoverSymbols(): Promise<PlcSymbol[]> {
    console.log(`[Symbol Discovery] Discovering symbols for connection ${this.connectionId}`);

    try {
      // Lese Symbol-Anzahl
      const symbolsResult = await this.adsClient.getSymbols();
      if (Array.isArray(symbolsResult)) {
        this.allAdsSymbols = symbolsResult;
      } else {
        // Assuming AdsSymbolContainer has a 'symbols' property that is an array
        this.allAdsSymbols = Array.isArray(symbolsResult.symbols) ? symbolsResult.symbols : [];
      }
      const symbolCount = this.allAdsSymbols.length;

      console.log(`[Symbol Discovery] Found ${symbolCount} symbols`);

      const symbols: PlcSymbol[] = [];

      // Lese alle Symbol-Informationen
      for (let i = 0; i < symbolCount; i++) {
        const adsSymbol = this.allAdsSymbols[i];

        // Filter anwenden wenn konfiguriert
        if (this.config.symbolFilter && !this.config.symbolFilter.test(adsSymbol.name)) {
          continue;
        }

        const symbol: PlcSymbol = {
          name: adsSymbol.name,
          indexGroup: adsSymbol.indexGroup,
          indexOffset: adsSymbol.indexOffset,
          size: adsSymbol.size,
          dataType: adsSymbol.type,
          comment: adsSymbol.comment,
          flags: adsSymbol.flags
        };

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
    // Echte ADS-Implementierung: Anzahl der Symbole aus der SPS lesen
    const uploadInfo = await this.adsClient.readPlcUploadInfo();
    return uploadInfo.symbolCount;
  }

  /**
   * Liest Symbol-Informationen für einen Index
   */
  private async readSymbolInfo(index: number): Promise<PlcSymbol> {
    // Symbol-Informationen aus dem bereits geladenen Array abrufen
    const adsSymbol = this.allAdsSymbols[index];

    if (!adsSymbol) {
      throw new Error(`Symbol at index ${index} not found.`);
    }

    return {
      name: adsSymbol.name,
      indexGroup: adsSymbol.indexGroup,
      indexOffset: adsSymbol.indexOffset,
      size: adsSymbol.size,
      dataType: adsSymbol.type,
      comment: adsSymbol.comment,
      flags: adsSymbol.flags
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
