import express, { Request, Response } from 'express';
import cors from 'cors';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AdsConnectionManager, AdsConnectionConfig } from './ads-connection-manager';
import { AdsVariable } from './ads-gateway';
import { MqttBroker } from './mqtt-broker';
import { AuditLogger } from './audit-logger';
import { PersistenceLayer } from './persistence';
import { MonitoringService } from './monitoring';
import { AdsDiscovery, AdsDevice } from './ads-discovery';

export interface ApiConfig {
  port: number;
  host: string;
}

export class RestApiV3 {
  private app: express.Application;
  private startTime: number;
  private auditLogger: AuditLogger;
  private persistence: PersistenceLayer;
  private monitoring: MonitoringService;
  private adsDiscovery: AdsDiscovery;

  constructor(
    private config: ApiConfig,
    private mqttBroker: MqttBroker,
    private adsConnectionManager: AdsConnectionManager
  ) {
    this.app = express();
    this.auditLogger = new AuditLogger();
    this.persistence = new PersistenceLayer();
    this.monitoring = new MonitoringService(this.persistence);
    this.adsDiscovery = new AdsDiscovery();
    this.startTime = Date.now();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Request logging and timing
    this.app.use((req: any, res: any, next: any) => {
      const startTime = Date.now();

      console.log(`[API] ${req.method} ${req.path}`);

      // Extract client info
      req.clientInfo = {
        userIp: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown') as string,
        userAgent: req.headers['user-agent'] || 'unknown'
      };

      // Track response time
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const success = res.statusCode < 400;
        this.monitoring.recordApiRequest(success, responseTime);
      });

      next();
    });

    // Serve static files (admin dashboard)
    this.app.use(express.static(path.join(process.cwd())));
  }

  private setupEventHandlers(): void {
    // Listen to audit logger events and persist them
    this.auditLogger.on('audit-log', (log) => {
      try {
        this.persistence.saveAuditLog(log);
      } catch (error) {
        console.error('[REST API] Failed to persist audit log:', error);
      }
    });

    // Listen to ADS Connection Manager events and persist variable changes
    this.adsConnectionManager.on('variable-changed', (data: any) => {
      try {
        const { connectionId, variable } = data;

        this.persistence.saveVariableValue({
          variableId: variable.id,
          variableName: `${connectionId}/${variable.name}`,
          value: variable.value,
          timestamp: variable.timestamp || Date.now(),
          quality: 'GOOD'
        });

        // Log the change
        this.auditLogger.log({
          action: 'VALUE_CHANGE',
          variableId: variable.id,
          variableName: variable.name,
          userId: 'system',
          details: `Value changed to ${variable.value} on connection ${connectionId}`,
          status: 'SUCCESS',
          newValue: variable.value
        });
      } catch (error) {
        console.error('[REST API] Failed to persist variable change:', error);
      }
    });

    // Register MQTT metrics
    this.mqttBroker.on('client-connected', () => this.monitoring.incrementMqttClients());
    this.mqttBroker.on('client-disconnected', () => this.monitoring.decrementMqttClients());
    this.mqttBroker.on('message-published', () => this.monitoring.incrementMqttMessages());
  }

  private setupRoutes(): void {
    // ===== Health & Info =====

    this.app.get('/api/health', (req: Request, res: Response) => {
      const connections = this.adsConnectionManager.getConnectionsStatus();

      res.json({
        status: 'ok',
        uptime: Date.now() - this.startTime,
        timestamp: Date.now(),
        connections: {
          total: connections.length,
          connected: connections.filter(c => c.connected).length,
          disconnected: connections.filter(c => !c.connected).length
        },
        mqtt: {
          clients: this.mqttBroker.getClients(),
          subscriptions: this.mqttBroker.getSubscriptions(),
        },
      });
    });

    // ===== ADS Connections Management =====

    // Get all connections
    this.app.get('/api/ads/connections', (req: Request, res: Response) => {
      const connections = this.adsConnectionManager.getAllConnections();
      const statuses = this.adsConnectionManager.getConnectionsStatus();

      const result = connections.map(conn => {
        const status = statuses.find(s => s.id === conn.id);
        return {
          ...conn,
          connected: status?.connected || false,
          variableCount: status?.variableCount || 0
        };
      });

      res.json(result);
    });

    // Get single connection
    this.app.get('/api/ads/connections/:id', (req: Request, res: Response) => {
      const { id } = req.params;
      const connection = this.adsConnectionManager.getConnection(id);

      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const status = this.adsConnectionManager.getConnectionsStatus().find(s => s.id === id);

      res.json({
        ...connection,
        connected: status?.connected || false,
        variableCount: status?.variableCount || 0
      });
    });

    // Create new connection
    this.app.post('/api/ads/connections', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;

      try {
        const config: AdsConnectionConfig = {
          id: uuidv4(),
          name: req.body.name,
          host: req.body.host,
          port: req.body.port,
          targetIp: req.body.targetIp,
          targetPort: req.body.targetPort,
          sourcePort: req.body.sourcePort,
          enabled: req.body.enabled !== false,
          description: req.body.description
        };

        await this.adsConnectionManager.addConnection(config);

        this.auditLogger.log({
          action: 'CREATE',
          variableId: `CONNECTION_${config.id}`,
          variableName: config.name,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Created ADS connection: ${config.name}`,
          status: 'SUCCESS',
        });

        res.status(201).json(config);
      } catch (error: any) {
        this.auditLogger.log({
          action: 'CREATE',
          variableId: 'CONNECTION',
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed to create connection: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: error.message });
      }
    });

    // Update connection
    this.app.put('/api/ads/connections/:id', async (req: Request, res: Response) => {
      const { id } = req.params;
      const clientInfo = (req as any).clientInfo;

      try {
        await this.adsConnectionManager.updateConnection(id, req.body);

        this.auditLogger.log({
          action: 'UPDATE',
          variableId: `CONNECTION_${id}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Updated ADS connection: ${id}`,
          status: 'SUCCESS',
        });

        res.json({ success: true });
      } catch (error: any) {
        this.auditLogger.log({
          action: 'UPDATE',
          variableId: `CONNECTION_${id}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed to update connection: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: error.message });
      }
    });

    // Delete connection
    this.app.delete('/api/ads/connections/:id', async (req: Request, res: Response) => {
      const { id } = req.params;
      const clientInfo = (req as any).clientInfo;

      try {
        await this.adsConnectionManager.removeConnection(id);

        this.auditLogger.log({
          action: 'DELETE',
          variableId: `CONNECTION_${id}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Deleted ADS connection: ${id}`,
          status: 'SUCCESS',
        });

        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Connect a specific connection
    this.app.post('/api/ads/connections/:id/connect', async (req: Request, res: Response) => {
      const { id } = req.params;
      const clientInfo = (req as any).clientInfo;

      try {
        await this.adsConnectionManager.connectConnection(id);

        this.auditLogger.log({
          action: 'UPDATE',
          variableId: `CONNECTION_${id}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Connected ADS connection: ${id}`,
          status: 'SUCCESS',
        });

        res.json({ success: true, connected: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Disconnect a specific connection
    this.app.post('/api/ads/connections/:id/disconnect', async (req: Request, res: Response) => {
      const { id } = req.params;
      const clientInfo = (req as any).clientInfo;

      try {
        await this.adsConnectionManager.disconnectConnection(id);

        this.auditLogger.log({
          action: 'UPDATE',
          variableId: `CONNECTION_${id}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Disconnected ADS connection: ${id}`,
          status: 'SUCCESS',
        });

        res.json({ success: true, connected: false });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get variables for a specific connection
    this.app.get('/api/ads/connections/:id/variables', (req: Request, res: Response) => {
      const { id } = req.params;
      const variables = this.adsConnectionManager.getVariablesByConnection(id);
      res.json(variables);
    });

    // Get discovered symbols for a connection
    this.app.get('/api/ads/connections/:id/symbols', (req: Request, res: Response) => {
      const { id } = req.params;
      const symbols = this.adsConnectionManager.getDiscoveredSymbols(id);
      res.json(symbols);
    });

    // Trigger manual symbol discovery
    this.app.post('/api/ads/connections/:id/discover', async (req: Request, res: Response) => {
      const { id } = req.params;
      const clientInfo = (req as any).clientInfo;

      try {
        const symbols = await this.adsConnectionManager.triggerSymbolDiscovery(id);

        this.auditLogger.log({
          action: 'UPDATE',
          variableId: `CONNECTION_${id}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Triggered symbol discovery on connection ${id}: ${symbols.length} symbols found`,
          status: 'SUCCESS',
        });

        res.json({ success: true, symbolCount: symbols.length, symbols });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Update symbol discovery config
    this.app.put('/api/ads/connections/:id/discovery-config', (req: Request, res: Response) => {
      const { id } = req.params;
      const clientInfo = (req as any).clientInfo;

      try {
        this.adsConnectionManager.updateSymbolDiscoveryConfig(id, req.body);

        this.auditLogger.log({
          action: 'UPDATE',
          variableId: `CONNECTION_${id}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Updated symbol discovery config on connection ${id}`,
          status: 'SUCCESS',
        });

        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== Variables Management =====

    // Get all variables (across all connections)
    this.app.get('/api/variables', (req: Request, res: Response) => {
      const variables = this.adsConnectionManager.getAllVariables();
      res.json(variables);
    });

    // Get specific variable
    this.app.get('/api/variables/:id', (req: Request, res: Response) => {
      const variable = this.adsConnectionManager.getVariable(req.params.id);
      if (!variable) {
        return res.status(404).json({ error: 'Variable not found' });
      }
      res.json(variable);
    });

    // Get variable history
    this.app.get('/api/variables/:id/history', (req: Request, res: Response) => {
      const { id } = req.params;
      const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
      const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 1000;

      const history = this.persistence.getVariableHistory(id, startTime, endTime, limit);
      res.json(history);
    });

    // Get variable statistics
    this.app.get('/api/variables/:id/statistics', (req: Request, res: Response) => {
      const { id } = req.params;

      const stats = this.persistence.getVariableStatistics(id);
      res.json(stats);
    });

    // Create new variable (requires connection ID)
    this.app.post('/api/variables', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;

      try {
        const { connectionId, ...variableData } = req.body;

        if (!connectionId) {
          return res.status(400).json({ error: 'connectionId is required' });
        }

        const variable: AdsVariable = {
          id: uuidv4(),
          name: variableData.name,
          path: variableData.path,
          type: variableData.type || 'DWORD',
          pollInterval: variableData.pollInterval || 1000,
          mqttTopic: variableData.mqttTopic || `ads/${connectionId}/${variableData.name}`,
        };

        await this.adsConnectionManager.addVariable(connectionId, variable);

        this.auditLogger.log({
          action: 'CREATE',
          variableId: variable.id,
          variableName: variable.name,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Created variable: ${variable.name} on connection ${connectionId}`,
          status: 'SUCCESS',
        });

        res.status(201).json(variable);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete variable
    this.app.delete('/api/variables/:id', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const { id } = req.params;

      try {
        const variable = this.adsConnectionManager.getVariable(id);

        await this.adsConnectionManager.removeVariable(id);

        this.auditLogger.log({
          action: 'DELETE',
          variableId: id,
          variableName: variable?.name || id,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Deleted variable: ${id}`,
          status: 'SUCCESS',
        });

        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== Monitoring =====

    this.app.get('/api/monitoring/summary', (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'public, max-age=2');
      res.json(this.monitoring.getSummary());
    });

    this.app.get('/api/monitoring/system', (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'public, max-age=2');
      res.json(this.monitoring.getSystemHealth());
    });

    this.app.get('/api/monitoring/metrics/:type', (req: Request, res: Response) => {
      const { type } = req.params;
      const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
      const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 1000;

      const metrics = this.persistence.getSystemMetrics(type, startTime, endTime, limit);
      res.json(metrics);
    });

    // ===== Audit Logs =====

    this.app.get('/api/audit/logs', (req: Request, res: Response) => {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const logs = this.persistence.getAuditLogs(limit);
      res.json(logs);
    });

    this.app.get('/api/audit/stats', (req: Request, res: Response) => {
      const stats = this.auditLogger.getStats();
      res.json(stats);
    });

    // ===== Persistence Management =====

    this.app.get('/api/persistence/stats', (req: Request, res: Response) => {
      const stats = this.persistence.getDatabaseStats();
      res.json(stats);
    });

    this.app.post('/api/persistence/cleanup', (req: Request, res: Response) => {
      const daysToKeep = req.body.daysToKeep || 30;
      const result = this.persistence.cleanupOldData(daysToKeep);
      res.json(result);
    });

    // ===== ADS Discovery =====

    // Start network scan for ADS devices
    this.app.post('/api/ads/discovery/scan', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      
      try {
        const { ipRange = '192.168.1.0/24', timeout = 5000 } = req.body;

        if (this.adsDiscovery.isCurrentlyScanning()) {
          return res.status(409).json({ error: 'Scan already in progress' });
        }

        // Start scan in background
        const scanPromise = this.adsDiscovery.discoverNetwork(ipRange, timeout);
        
        this.auditLogger.log({
          action: 'SCAN',
          variableId: 'ADS_DISCOVERY',
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Started ADS network scan for ${ipRange}`,
          status: 'SUCCESS',
        });

        res.json({ 
          success: true, 
          message: 'Scan started',
          scanning: true,
          ipRange,
          timeout
        });

        // Handle scan completion
        try {
          const devices = await scanPromise;
          this.auditLogger.log({
            action: 'SCAN',
            variableId: 'ADS_DISCOVERY',
            userId: req.headers['x-user-id'] as string || 'anonymous',
            details: `ADS network scan completed: ${devices.length} devices found`,
            status: 'SUCCESS',
          });
        } catch (error) {
          console.error('[ADS Discovery] Scan failed:', error);
        }

      } catch (error: any) {
        this.auditLogger.log({
          action: 'SCAN',
          variableId: 'ADS_DISCOVERY',
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed to start ADS scan: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: error.message });
      }
    });

    // Get discovered ADS devices
    this.app.get('/api/ads/discovery/devices', (req: Request, res: Response) => {
      const devices = this.adsDiscovery.getDiscoveredDevices();
      const isScanning = this.adsDiscovery.isCurrentlyScanning();
      
      res.json({
        devices,
        scanning: isScanning,
        count: devices.length
      });
    });

    // Test connection to specific ADS device
    this.app.post('/api/ads/discovery/test/:ip', async (req: Request, res: Response) => {
      const { ip } = req.params;
      const clientInfo = (req as any).clientInfo;

      try {
        const device: AdsDevice = {
          ip,
          amsNetId: `${ip}.1.1`,
          port: 48898,
          reachable: false
        };

        const isReachable = await this.adsDiscovery.testConnection(device);

        this.auditLogger.log({
          action: 'TEST',
          variableId: `ADS_DEVICE_${ip}`,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Tested ADS connection to ${ip}: ${isReachable ? 'Success' : 'Failed'}`,
          status: isReachable ? 'SUCCESS' : 'FAILED',
        });

        res.json({
          success: true,
          ip,
          reachable: isReachable,
          responseTime: isReachable ? 'OK' : 'Timeout'
        });

      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Cancel ongoing scan
    this.app.post('/api/ads/discovery/cancel', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;

      this.adsDiscovery.cancelScan();

      this.auditLogger.log({
        action: 'CANCEL',
        variableId: 'ADS_DISCOVERY',
        userId: req.headers['x-user-id'] as string || 'anonymous',
        userIp: clientInfo.userIp,
        userAgent: clientInfo.userAgent,
        details: 'Cancelled ADS network scan',
        status: 'SUCCESS',
      });

      res.json({ success: true, message: 'Scan cancelled' });
    });

    // Create ADS connection from discovered device
    this.app.post('/api/ads/discovery/create-connection', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;

      try {
        const { device, name, description } = req.body;

        if (!device || !device.ip) {
          return res.status(400).json({ error: 'Device information required' });
        }

        const config: AdsConnectionConfig = {
          id: uuidv4(),
          name: name || `TwinCAT ${device.ip}`,
          host: device.ip,
          port: device.port || 48898,
          targetIp: device.ip,
          targetPort: 851, // Standard TwinCAT ADS port
          sourcePort: 32750,
          enabled: true,
          description: description || `Auto-discovered TwinCAT device at ${device.ip}`,
          symbolDiscovery: {
            autoDiscovery: true,
            discoveryInterval: 30000,
            autoAddVariables: true,
            defaultPollInterval: 1000,
            symbolFilter: /^GVL\./
          }
        };

        await this.adsConnectionManager.addConnection(config);

        this.auditLogger.log({
          action: 'CREATE',
          variableId: `CONNECTION_${config.id}`,
          variableName: config.name,
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Created ADS connection from discovery: ${config.name} (${device.ip})`,
          status: 'SUCCESS',
        });

        res.status(201).json({
          success: true,
          connection: config,
          message: 'Connection created successfully'
        });

      } catch (error: any) {
        this.auditLogger.log({
          action: 'CREATE',
          variableId: 'CONNECTION_DISCOVERY',
          userId: req.headers['x-user-id'] as string || 'anonymous',
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed to create connection from discovery: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: error.message });
      }
    });

    // ===== MQTT Operations =====

    this.app.post('/api/publish', (req: Request, res: Response) => {
      const { topic, message } = req.body;

      if (!topic || message === undefined) {
        return res.status(400).json({ error: 'Topic and message are required' });
      }

      this.mqttBroker.publish(topic, JSON.stringify(message));
      res.json({ success: true });
    });

    // ===== API Documentation =====

    this.app.get('/api', (req: Request, res: Response) => {
      res.json({
        version: '3.0.0',
        description: 'ADS-MQTT Broker REST API v3 - Multi-Connection & Auto-Discovery Support',
        endpoints: [
          { method: 'GET', path: '/api/health', description: 'Get system health' },
          { method: 'GET', path: '/api/ads/connections', description: 'List all ADS connections' },
          { method: 'GET', path: '/api/ads/connections/:id', description: 'Get specific connection' },
          { method: 'POST', path: '/api/ads/connections', description: 'Create new connection' },
          { method: 'PUT', path: '/api/ads/connections/:id', description: 'Update connection' },
          { method: 'DELETE', path: '/api/ads/connections/:id', description: 'Delete connection' },
          { method: 'POST', path: '/api/ads/connections/:id/connect', description: 'Connect to ADS' },
          { method: 'POST', path: '/api/ads/connections/:id/disconnect', description: 'Disconnect from ADS' },
          { method: 'GET', path: '/api/ads/connections/:id/variables', description: 'Get connection variables' },
          { method: 'GET', path: '/api/ads/connections/:id/symbols', description: 'Get discovered PLC symbols' },
          { method: 'POST', path: '/api/ads/connections/:id/discover', description: 'Trigger symbol discovery' },
          { method: 'PUT', path: '/api/ads/connections/:id/discovery-config', description: 'Update discovery config' },
          { method: 'GET', path: '/api/variables', description: 'List all variables' },
          { method: 'GET', path: '/api/variables/:id', description: 'Get specific variable' },
          { method: 'GET', path: '/api/variables/:id/history', description: 'Get variable history' },
          { method: 'GET', path: '/api/variables/:id/statistics', description: 'Get variable statistics' },
          { method: 'POST', path: '/api/variables', description: 'Create new variable' },
          { method: 'DELETE', path: '/api/variables/:id', description: 'Delete variable' },
          { method: 'POST', path: '/api/publish', description: 'Publish MQTT message' },
          { method: 'GET', path: '/api/monitoring/summary', description: 'Get monitoring summary' },
          { method: 'GET', path: '/api/monitoring/system', description: 'Get system health' },
          { method: 'GET', path: '/api/monitoring/metrics/:type', description: 'Get specific metrics' },
          { method: 'GET', path: '/api/audit/logs', description: 'Get audit logs' },
          { method: 'GET', path: '/api/audit/stats', description: 'Get audit statistics' },
          { method: 'GET', path: '/api/persistence/stats', description: 'Get database statistics' },
          { method: 'POST', path: '/api/persistence/cleanup', description: 'Cleanup old data' },
        ],
      });
    });
  }

  public getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  public getPersistence(): PersistenceLayer {
    return this.persistence;
  }

  public getMonitoring(): MonitoringService {
    return this.monitoring;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.config.port, this.config.host, () => {
        console.log(`[REST API v3] Server running on http://${this.config.host}:${this.config.port}`);
        console.log(`[REST API] Dashboard: http://${this.config.host}:${this.config.port}/admin-dashboard.html`);
        resolve();
      });
    });
  }
}
