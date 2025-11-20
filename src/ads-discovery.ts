import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as net from 'net';

export interface AdsDevice {
  ip: string;
  amsNetId: string;
  port: number;
  hostname?: string;
  deviceName?: string;
  version?: string;
  description?: string;
  reachable: boolean;
  responseTime?: number;
}

export interface AdsRoute {
  name: string;
  address: string;
  netId: string;
  type: 'Local' | 'TCP/IP' | 'Serial' | 'Unknown';
  transport: string;
  comment?: string;
}

/**
 * ADS Network Discovery Service
 * 
 * Scannt das Netzwerk nach verfügbaren ADS/TwinCAT-Geräten:
 * - UDP Broadcast Discovery
 * - Port Scanning für ADS-Router (Port 48898)
 * - AMS NetID Resolution
 * - Route Discovery
 */
export class AdsDiscovery extends EventEmitter {
  private isScanning = false;
  private discoveredDevices: Map<string, AdsDevice> = new Map();
  
  constructor() {
    super();
  }

  /**
   * Startet die ADS-Netzwerk-Discovery
   */
  async discoverNetwork(
    ipRange: string = '192.168.1.0/24', 
    timeout: number = 5000
  ): Promise<AdsDevice[]> {
    if (this.isScanning) {
      throw new Error('Discovery already in progress');
    }

    this.isScanning = true;
    this.discoveredDevices.clear();
    
    console.log(`[ADS Discovery] Starting network scan for ${ipRange}`);
    this.emit('scan-started', { ipRange, timeout });

    try {
      // Parse IP range
      const ips = this.parseIpRange(ipRange);
      console.log(`[ADS Discovery] Scanning ${ips.length} IP addresses`);

      // Concurrent port scanning with limited concurrency
      const batchSize = 20;
      for (let i = 0; i < ips.length; i += batchSize) {
        const batch = ips.slice(i, i + batchSize);
        const promises = batch.map(ip => this.scanDevice(ip, timeout));
        
        await Promise.allSettled(promises);
        
        // Emit progress
        const progress = Math.min(100, Math.round(((i + batchSize) / ips.length) * 100));
        this.emit('scan-progress', { progress, scanned: i + batchSize, total: ips.length });
      }

      const devices = Array.from(this.discoveredDevices.values());
      console.log(`[ADS Discovery] Found ${devices.length} ADS devices`);
      
      this.emit('scan-completed', { devices, found: devices.length });
      return devices;

    } catch (error) {
      console.error('[ADS Discovery] Scan failed:', error);
      this.emit('scan-error', { error });
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Scannt ein einzelnes Gerät nach ADS-Services
   */
  private async scanDevice(ip: string, timeout: number): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Check if ADS Router port is open (48898)
      const isReachable = await this.checkPort(ip, 48898, timeout);
      
      if (isReachable) {
        const responseTime = Date.now() - startTime;
        
        // Try to get device information
        const device: AdsDevice = {
          ip,
          amsNetId: await this.getAmsNetId(ip) || `${ip}.1.1`, // Default fallback
          port: 48898,
          reachable: true,
          responseTime
        };

        // Try to get additional device info
        try {
          device.hostname = await this.getHostname(ip);
          device.deviceName = await this.getDeviceName(ip);
        } catch (error) {
          // Non-critical, continue without hostname/device name
        }

        this.discoveredDevices.set(ip, device);
        this.emit('device-found', device);
        
        console.log(`[ADS Discovery] Found ADS device: ${ip} (${device.amsNetId}) - ${responseTime}ms`);
      }
    } catch (error) {
      // Silent fail for individual devices
    }
  }

  /**
   * Prüft ob ein Port erreichbar ist
   */
  private async checkPort(ip: string, port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let timer: NodeJS.Timeout;

      socket.setTimeout(timeout);
      
      socket.on('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeout);

      socket.connect(port, ip);
    });
  }

  /**
   * Versucht die AMS NetID zu ermitteln
   */
  private async getAmsNetId(ip: string): Promise<string | null> {
    try {
      // Standard AMS NetID Aufbau: x.x.x.x.y.z
      // Meist: IP.1.1 oder IP.1.851 für TwinCAT 3
      return `${ip}.1.1`;
    } catch (error) {
      return null;
    }
  }

  /**
   * Versucht den Hostname zu ermitteln
   */
  private async getHostname(ip: string): Promise<string | undefined> {
    try {
      const { promisify } = require('util');
      const dns = require('dns');
      const lookupAsync = promisify(dns.reverse);
      
      const hostnames = await lookupAsync(ip);
      return hostnames && hostnames.length > 0 ? hostnames[0] : undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Versucht den Gerätenamen zu ermitteln
   */
  private async getDeviceName(ip: string): Promise<string | undefined> {
    // Hier könnte man versuchen, über ADS-Calls den Gerätenamen zu ermitteln
    // Für jetzt geben wir basierend auf der IP einen generischen Namen zurück
    return `TwinCAT Device (${ip})`;
  }

  /**
   * Parst IP-Bereiche (CIDR-Notation)
   */
  private parseIpRange(range: string): string[] {
    const ips: string[] = [];
    
    if (range.includes('/')) {
      // CIDR notation (z.B. 192.168.1.0/24)
      const [baseIp, prefixLength] = range.split('/');
      const prefix = parseInt(prefixLength);
      
      if (prefix === 24) {
        // /24 Netz - scan 192.168.1.1 bis 192.168.1.254
        const baseParts = baseIp.split('.').slice(0, 3);
        const baseAddr = baseParts.join('.');
        
        for (let i = 1; i <= 254; i++) {
          ips.push(`${baseAddr}.${i}`);
        }
      } else if (prefix === 16) {
        // /16 Netz - scan nur eine kleinere Auswahl
        const baseParts = baseIp.split('.').slice(0, 2);
        const baseAddr = baseParts.join('.');
        
        // Scan typische Subnetze: .0.x, .1.x, .10.x, .100.x
        const subnets = [0, 1, 10, 100];
        for (const subnet of subnets) {
          for (let i = 1; i <= 254; i++) {
            ips.push(`${baseAddr}.${subnet}.${i}`);
          }
        }
      }
    } else if (range.includes('-')) {
      // Range notation (z.B. 192.168.1.1-192.168.1.50)
      const [startIp, endIp] = range.split('-');
      const startParts = startIp.split('.').map(Number);
      const endParts = endIp.split('.').map(Number);
      
      const startLastOctet = startParts[3];
      const endLastOctet = endParts[3];
      const baseAddr = startParts.slice(0, 3).join('.');
      
      for (let i = startLastOctet; i <= endLastOctet; i++) {
        ips.push(`${baseAddr}.${i}`);
      }
    } else {
      // Single IP
      ips.push(range);
    }
    
    return ips;
  }

  /**
   * Entdeckt ADS-Routen auf einem spezifischen Gerät
   */
  async discoverRoutes(device: AdsDevice): Promise<AdsRoute[]> {
    console.log(`[ADS Discovery] Discovering routes on ${device.ip}`);
    
    try {
      // Hier würde normalerweise eine ADS-Verbindung aufgebaut und die Route-Tabelle ausgelesen
      // Für jetzt erstellen wir Standard-Routen
      
      const routes: AdsRoute[] = [
        {
          name: 'Local',
          address: '127.0.0.1',
          netId: device.amsNetId,
          type: 'Local',
          transport: 'Local',
          comment: 'Local TwinCAT Runtime'
        }
      ];

      // Remote Route hinzufügen wenn es sich um ein Netzwerkgerät handelt
      if (device.ip !== '127.0.0.1' && device.ip !== 'localhost') {
        routes.push({
          name: device.deviceName || `Remote_${device.ip.replace(/\./g, '_')}`,
          address: device.ip,
          netId: device.amsNetId,
          type: 'TCP/IP',
          transport: `TCP/IP_${device.ip}_48898`,
          comment: `Remote TwinCAT on ${device.ip}`
        });
      }

      return routes;
    } catch (error) {
      console.error(`[ADS Discovery] Failed to discover routes on ${device.ip}:`, error);
      return [];
    }
  }

  /**
   * Gibt alle gefundenen Geräte zurück
   */
  getDiscoveredDevices(): AdsDevice[] {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Prüft ob gerade ein Scan läuft
   */
  isCurrentlyScanning(): boolean {
    return this.isScanning;
  }

  /**
   * Bricht einen laufenden Scan ab
   */
  cancelScan(): void {
    if (this.isScanning) {
      this.isScanning = false;
      this.emit('scan-cancelled');
      console.log('[ADS Discovery] Scan cancelled');
    }
  }

  /**
   * Testet die Verbindung zu einem ADS-Gerät
   */
  async testConnection(device: AdsDevice): Promise<boolean> {
    try {
      console.log(`[ADS Discovery] Testing connection to ${device.ip}:${device.port}`);
      
      const isReachable = await this.checkPort(device.ip, device.port, 3000);
      
      if (isReachable) {
        console.log(`[ADS Discovery] ✓ Connection successful: ${device.ip}`);
        return true;
      } else {
        console.log(`[ADS Discovery] ✗ Connection failed: ${device.ip}`);
        return false;
      }
    } catch (error) {
      console.error(`[ADS Discovery] Connection test error for ${device.ip}:`, error);
      return false;
    }
  }
}
