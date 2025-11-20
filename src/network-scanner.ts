import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ScannedDevice {
  name?: string;
  hostname?: string;
  netId?: string;
  ipAddress: string;
  port: number;
  runtime?: string;
  systemInfo?: string;
  isReachable: boolean;
}

export class NetworkScanner {
  // Beckhoff recommends scanning ports 800-1000 for ADS services
  private readonly ADS_PORT_RANGE_START = 800;
  private readonly ADS_PORT_RANGE_END = 900; // Reduced from 1000 to 900 for faster scanning
  private readonly COMMON_ADS_PORTS = [48898, 801, 851]; // Check these first
  private readonly SCAN_TIMEOUT = 300; // 300ms per port for faster scanning

  /**
   * Parse network CIDR notation (e.g., "192.168.1.0/24")
   * Returns array of IP addresses to scan
   */
  private parseNetwork(network: string): string[] {
    const [baseIp, maskStr] = network.split('/');
    const mask = parseInt(maskStr || '24');
    
    if (mask !== 24) {
      throw new Error('Currently only /24 networks are supported');
    }

    const parts = baseIp.split('.');
    if (parts.length !== 4) {
      throw new Error('Invalid IP address format');
    }

    const networkBase = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const ips: string[] = [];

    // Scan host IPs 1-254 (skip 0 and 255)
    for (let i = 1; i < 255; i++) {
      ips.push(`${networkBase}.${i}`);
    }

    return ips;
  }

  /**
   * Check if a host is reachable via ping
   */
  private async pingHost(ip: string): Promise<boolean> {
    try {
      // Use platform-specific ping command
      const isWindows = process.platform === 'win32';
      const pingCmd = isWindows 
        ? `ping -n 1 -w 200 ${ip}` 
        : `ping -c 1 -W 0.2 ${ip}`;

      const { stdout } = await execAsync(pingCmd);
      
      // Check for success indicators
      return isWindows 
        ? stdout.includes('TTL=') 
        : stdout.includes('1 received');
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if ADS/TwinCAT port is open
   */
  private async checkAdsPort(ip: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();
      
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, this.SCAN_TIMEOUT);

      socket.on('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });

      socket.connect(port, ip);
    });
  }

  /**
   * Resolve hostname from IP address
   */
  private async getHostname(ip: string): Promise<string | undefined> {
    try {
      const dns = require('dns').promises;
      const hostnames = await dns.reverse(ip);
      return hostnames && hostnames.length > 0 ? hostnames[0] : undefined;
    } catch (error) {
      // DNS lookup failed, try NetBIOS name
      try {
        const { stdout } = await execAsync(`nbtstat -A ${ip}`, { timeout: 1000 });
        const match = stdout.match(/<00>\s+UNIQUE\s+(\S+)/);
        return match ? match[1] : undefined;
      } catch {
        return undefined;
      }
    }
  }

  /**
   * Try to identify TwinCAT runtime version and system info
   */
  private async getTwinCATInfo(ip: string, port: number): Promise<{ runtime?: string; systemInfo?: string }> {
    try {
      // Detect TwinCAT runtime based on port
      let runtime: string | undefined;
      let systemInfo: string | undefined;

      // Common TwinCAT port mappings
      if (port === 851) {
        runtime = 'TwinCAT 3';
        systemInfo = 'TwinCAT 3 Runtime (Port 851)';
      } else if (port === 801) {
        runtime = 'TwinCAT 2';
        systemInfo = 'TwinCAT 2 Runtime (Port 801)';
      } else if (port === 48898) {
        runtime = 'TwinCAT 3';
        systemInfo = 'TwinCAT 3 System Service (Port 48898)';
      } else if (port >= 800 && port <= 900) {
        runtime = 'TwinCAT';
        systemInfo = `TwinCAT System (Port ${port})`;
      } else {
        systemInfo = `ADS Service on port ${port}`;
      }

      return { runtime, systemInfo };
    } catch (error) {
      return {};
    }
  }

  /**
   * Scan a single IP for ADS/TwinCAT services
   * Checks common ports first, then scans full range 800-1000
   */
  private async scanHost(ip: string, fullScan: boolean = false): Promise<ScannedDevice | null> {
    // Skip ping check - many firewalls block ICMP but allow TCP
    // Go directly to port scanning which is more reliable

    // Check common ADS ports first for quick detection
    for (const port of this.COMMON_ADS_PORTS) {
      const isOpen = await this.checkAdsPort(ip, port);
      
      if (isOpen) {
        const { runtime, systemInfo } = await this.getTwinCATInfo(ip, port);
        const hostname = await this.getHostname(ip);
        
        // Generate NetID from IP (standard format: IP.1.1)
        const netId = `${ip}.1.1`;

        return {
          name: hostname || `PLC-${ip.split('.').pop()}`,
          hostname,
          netId,
          ipAddress: ip,
          port,
          runtime,
          systemInfo: systemInfo || `ADS Service on port ${port}`,
          isReachable: true
        };
      }
    }

    // If no common port found and full scan is enabled, check entire range (800-900)
    if (fullScan) {
      for (let port = this.ADS_PORT_RANGE_START; port <= this.ADS_PORT_RANGE_END; port++) {
        // Skip already checked common ports
        if (this.COMMON_ADS_PORTS.includes(port)) continue;

        const isOpen = await this.checkAdsPort(ip, port);
        
        if (isOpen) {
          const { runtime, systemInfo } = await this.getTwinCATInfo(ip, port);
          const hostname = await this.getHostname(ip);
          const netId = `${ip}.1.1`;

          return {
            name: hostname || `PLC-${ip.split('.').pop()}`,
            hostname,
            netId,
            ipAddress: ip,
            port,
            runtime,
            systemInfo: systemInfo || `ADS Service on port ${port}`,
            isReachable: true
          };
        }
      }
    }

    return null;
  }

  /**
   * Scan entire network for ADS/TwinCAT devices
   * Uses parallel scanning with concurrency limit
   * @param fullPortScan - If true, scans all ports 800-900 (slower but more thorough)
   * @param onProgress - Optional callback for progress updates
   */
  async scanNetwork(
    network: string, 
    fullPortScan: boolean = false, 
    maxConcurrency: number = 50,
    onProgress?: (progress: { scanned: number, total: number, found: number, devices: ScannedDevice[] }) => void
  ): Promise<ScannedDevice[]> {
    const ips = this.parseNetwork(network);
    const devices: ScannedDevice[] = [];
    
    console.log(`[Network Scanner] Starting ${fullPortScan ? 'FULL' : 'FAST'} scan of ${network} (${ips.length} hosts, ${maxConcurrency} concurrent)`);
    if (fullPortScan) {
      console.log(`[Network Scanner] Scanning ports ${this.ADS_PORT_RANGE_START}-${this.ADS_PORT_RANGE_END} per host`);
    }
    
    // Scan in large batches for maximum speed
    for (let i = 0; i < ips.length; i += maxConcurrency) {
      const batch = ips.slice(i, i + maxConcurrency);
      const results = await Promise.all(
        batch.map(ip => this.scanHost(ip, fullPortScan))
      );

      // Filter out null results and add to devices
      const foundDevices = results.filter(device => device !== null) as ScannedDevice[];
      devices.push(...foundDevices);

      // Call progress callback if provided
      const scanned = Math.min(i + maxConcurrency, ips.length);
      if (onProgress) {
        onProgress({ scanned, total: ips.length, found: devices.length, devices: [...devices] });
      }

      // Progress logging
      if ((i + maxConcurrency) % 100 === 0 || i + maxConcurrency >= ips.length) {
        console.log(`[Network Scanner] Progress: ${scanned}/${ips.length} hosts scanned, ${devices.length} devices found`);
      }
    }

    console.log(`[Network Scanner] Scan complete: Found ${devices.length} ADS/TwinCAT device(s)`);
    return devices;
  }

  /**
   * Quick scan - only check reachable hosts with common ports
   */
  async quickScan(network: string): Promise<ScannedDevice[]> {
    const ips = this.parseNetwork(network);
    const devices: ScannedDevice[] = [];
    
    console.log(`[Network Scanner] ULTRA-FAST scan of ${network} (common ADS ports only, 50 concurrent)`);
    
    // Scan all IPs in parallel batches of 50 - no ping check needed
    // Port scanning is more reliable than ping anyway
    for (let i = 0; i < ips.length; i += 50) {
      const batch = ips.slice(i, i + 50);
      const results = await Promise.all(
        batch.map(ip => this.scanHost(ip, false))
      );

      // Filter out null results and add to devices
      const foundDevices = results.filter(device => device !== null) as ScannedDevice[];
      devices.push(...foundDevices);

      if ((i + 50) % 100 === 0 || i + 50 >= ips.length) {
        console.log(`[Network Scanner] Progress: ${Math.min(i + 50, ips.length)}/${ips.length} hosts scanned, ${devices.length} devices found`);
      }
    }

    console.log(`[Network Scanner] Quick scan complete: Found ${devices.length} ADS/TwinCAT device(s)`);
    return devices;
  }
}
