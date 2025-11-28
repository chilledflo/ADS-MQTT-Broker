import { EventEmitter } from 'events';
import { Client } from 'ads-client';
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
    private config: SymbolDiscoveryConfig,
    private client: Client | null = null
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
   * Liest den OnlineChange-Counter aus der SPS
   * Dieser wird bei jedem OnlineChange inkrementiert
   */
  private async readSymbolVersion(): Promise<number> {
    if (!this.client) {
      // Fallback: Verwende aktuellen Wert
      return this.lastSymbolVersion || 0;
    }

    try {
      // Lese Symbol-Upload-Info Header (48 bytes)
      // Offset 0: OnlineChangeCnt (UDINT, 4 bytes)
      const buffer = await this.client.readRaw(0xF00F, 0x0000, 48);
      const onlineChangeCnt = buffer.readUInt32LE(0);
      return onlineChangeCnt;
    } catch (error) {
      console.error('[Symbol Discovery] Failed to read OnlineChangeCnt:', error);
      // Fallback: Verwende aktuellen Wert
      return this.lastSymbolVersion || 0;
    }
  }

  /**
   * Liest alle Symbole aus der SPS
   * Verwendet die ads-client getSymbols() Methode (funktioniert mit TC2 und TC3)
   */
  async discoverSymbols(): Promise<PlcSymbol[]> {
    console.log(`[Symbol Discovery] Discovering symbols for connection ${this.connectionId}`);

    try {
      if (!this.client) {
        throw new Error('ADS client not available');
      }

      // Verwende ads-client getSymbols() - funktioniert mit TC2 und TC3
      const adsSymbols = await this.client.getSymbols();
      const symbolNames = Object.keys(adsSymbols);

      console.log(`[Symbol Discovery] Found ${symbolNames.length} symbols`);
      
      // Debug: Zeige ALLE Symbol-Namen und Typen
      if (symbolNames.length < 50) {
        console.log('[Symbol Discovery] ALL symbols:', symbolNames.join(', '));
        // Zeige erste 5 Symbole mit Typ-Info
        console.log('[Symbol Discovery] Sample types:');
        symbolNames.slice(0, 5).forEach(name => {
          const sym = adsSymbols[name];
          console.log(`  ${name}: type="${sym.type}", size=${sym.size}`);
        });
      } else {
        console.log('[Symbol Discovery] First 30 symbols:', symbolNames.slice(0, 30).join(', '));
      }

      const symbols: PlcSymbol[] = [];

      // Konvertiere ads-client Symbole zu PlcSymbol Format
      for (const name of symbolNames) {
        const adsSymbol = adsSymbols[name];

        // Filter anwenden wenn konfiguriert
        if (this.config.symbolFilter && !this.config.symbolFilter.test(name)) {
          continue;
        }

        const symbol: PlcSymbol = {
          name: name,
          indexGroup: adsSymbol.indexGroup || 0,
          indexOffset: adsSymbol.indexOffset || 0,
          size: adsSymbol.size || 0,
          dataType: adsSymbol.type || 'UNKNOWN',
          comment: adsSymbol.comment || '',
          flags: adsSymbol.flags || 0
        };

        symbols.push(symbol);
        this.symbols.set(symbol.name, symbol);
      }

      console.log(`[Symbol Discovery] Discovered ${symbols.length} symbols (after filtering)`);

      // Expandiere Struct-Felder zu einzelnen Symbolen
      const expandedSymbols = await this.expandStructSymbols(symbols);
      console.log(`[Symbol Discovery] Expanded to ${expandedSymbols.length} symbols (including struct fields)`);

      // Event mit gefundenen Symbolen
      this.emit('symbols-discovered', {
        connectionId: this.connectionId,
        symbols: expandedSymbols,
        total: symbolNames.length,
        filtered: expandedSymbols.length
      });

      // Automatisch Variablen anlegen wenn konfiguriert
      if (this.config.autoAddVariables) {
        const variables = this.symbolsToVariables(expandedSymbols);
        this.emit('variables-discovered', {
          connectionId: this.connectionId,
          variables: variables
        });
      }

      return expandedSymbols;
    } catch (error) {
      console.error('[Symbol Discovery] Error discovering symbols:', error);
      throw error;
    }
  }

  /**
   * Expandiert Struct-Symbole zu einzelnen Feldern
   * Sucht nach allen Symbolen die mit "parent." beginnen (Dot-Notation)
   */
  private async expandStructSymbols(symbols: PlcSymbol[]): Promise<PlcSymbol[]> {
    if (!this.client) {
      return symbols;
    }

    const expandedSymbols: PlcSymbol[] = [];
    
    // Hole ALLE Symbole vom PLC (inkl. Sub-Members)
    const allAdsSymbols = await this.client.getSymbols();
    const allSymbolNames = Object.keys(allAdsSymbols);
    
    console.log(`[Symbol Discovery] Total symbols in PLC (with sub-members): ${allSymbolNames.length}`);

    for (const symbol of symbols) {
      // Füge das Parent-Symbol hinzu
      expandedSymbols.push(symbol);

      // Prüfe ob es eine Struct ist (enthält meist STRUCT im Type oder hat bestimmte Flags)
      if (this.isStructType(symbol.dataType)) {
        // Suche nach allen Symbolen die mit "symbol.name." beginnen (direkte Children, keine grand-children)
        const childSymbolNames = allSymbolNames.filter(name => 
          name.startsWith(`${symbol.name}.`) &&           // Beginnt mit Parent + Dot
          !name.substring(symbol.name.length + 1).includes('.')  // Keine weiteren Dots = direkte Children
        );
        
        if (childSymbolNames.length > 0) {
          console.log(`[Symbol Discovery] ✓ Expanding struct ${symbol.name} with ${childSymbolNames.length} fields`);
          
          for (const childName of childSymbolNames) {
            const childAdsSymbol = allAdsSymbols[childName];
            const childSymbol: PlcSymbol = {
              name: childName,
              indexGroup: childAdsSymbol.indexGroup || 0,
              indexOffset: childAdsSymbol.indexOffset || 0,
              size: childAdsSymbol.size || 0,
              dataType: childAdsSymbol.type || 'UNKNOWN',
              comment: childAdsSymbol.comment || '',
              flags: childAdsSymbol.flags || 0
            };
            expandedSymbols.push(childSymbol);
            this.symbols.set(childSymbol.name, childSymbol);
          }
        }
      }
    }

    return expandedSymbols;
  }

  /**
   * Prüft ob ein Datentyp eine Struct ist
   */
  private isStructType(dataType: string): boolean {
    // Structs haben meist einen custom Type-Namen (nicht die Standard-Typen)
    const basicTypes = ['BOOL', 'BYTE', 'WORD', 'DWORD', 'SINT', 'USINT', 'INT', 'UINT', 
                        'DINT', 'UDINT', 'LINT', 'ULINT', 'REAL', 'LREAL', 'STRING', 'WSTRING',
                        'TIME', 'DATE', 'TOD', 'DT'];
    
    return !basicTypes.includes(dataType.toUpperCase()) && dataType !== 'UNKNOWN';
  }

  /**
   * Liest die Anzahl der Symbole
   */
  private async readSymbolCount(): Promise<number> {
    if (!this.client) {
      throw new Error('ADS client not available');
    }

    try {
      // Lese Upload-Info Header (24 Bytes)
      const buffer = await this.client.readRaw(0xF00F, 0x0000, 24);
      // Bytes 0-3 enthalten die Symbol-Anzahl
      return buffer.readUInt32LE(0);
    } catch (error) {
      console.error('[Symbol Discovery] Failed to read symbol count:', error);
      throw error;
    }
  }

  /**
   * Liest Symbol-Informationen für einen Index
   */
  private async readSymbolInfo(index: number): Promise<PlcSymbol> {
    if (!this.client) {
      throw new Error('ADS client not available');
    }

    try {
      // Lese Symbol-Upload-Info für diesen Index
      // IndexGroup: 0xF009, IndexOffset: index
      const entryBuffer = await this.client.readRaw(0xF009, index, 1024);
      
      // Parse Symbol Entry
      let offset = 0;
      const entryLength = entryBuffer.readUInt32LE(offset); offset += 4;
      const indexGroup = entryBuffer.readUInt32LE(offset); offset += 4;
      const indexOffset = entryBuffer.readUInt32LE(offset); offset += 4;
      const size = entryBuffer.readUInt32LE(offset); offset += 4;
      const dataType = entryBuffer.readUInt32LE(offset); offset += 4;
      const flags = entryBuffer.readUInt32LE(offset); offset += 4;
      
      // Lese Namen (null-terminated string)
      const nameLength = entryBuffer.readUInt16LE(offset); offset += 2;
      const name = entryBuffer.toString('utf8', offset, offset + nameLength - 1); // -1 für null-terminator
      offset += nameLength;
      
      // Lese Typ-Namen (null-terminated string)
      const typeLength = entryBuffer.readUInt16LE(offset); offset += 2;
      const typeName = entryBuffer.toString('utf8', offset, offset + typeLength - 1);
      offset += typeLength;
      
      // Lese Kommentar (null-terminated string)
      const commentLength = entryBuffer.readUInt16LE(offset); offset += 2;
      const comment = commentLength > 1 ? entryBuffer.toString('utf8', offset, offset + commentLength - 1) : '';
      
      return {
        name,
        indexGroup,
        indexOffset,
        size,
        dataType: typeName || this.guessTypeFromSize(size),
        comment,
        flags
      };
    } catch (error) {
      console.error(`[Symbol Discovery] Failed to read symbol info for index ${index}:`, error);
      throw error;
    }
  }

  /**
   * Schätzt den Datentyp basierend auf der Größe
   */
  private guessTypeFromSize(size: number): string {
    const sizeMap: { [key: number]: string } = {
      1: 'BOOL',
      2: 'INT',
      4: 'DINT',
      8: 'LREAL'
    };
    return sizeMap[size] || 'UNKNOWN';
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
        mqttTopic: `ads/${this.connectionId}/${symbol.name.replace(/\./g, '/')}`,
        useNotification: true // ⚡ ADS Notification für harte Echtzeit <1ms
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
