import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AdsGateway, AdsVariable } from './ads-gateway';
import { MqttBroker } from './mqtt-broker';
import { AuditLogger } from './audit-logger';
import { NetworkScanner } from './network-scanner';
import { ErrorManager } from './error-manager';

export interface ApiConfig {
  port: number;
  host: string;
}

export interface AdsRoute {
  id: string;
  name: string;
  netId: string;
  ipAddress: string;
  port: number;
  description?: string;
  active: boolean;
}

export class RestApi {
  private app: express.Application;
  private startTime: number;
  private auditLogger: AuditLogger;
  private adsRoutes: Map<string, AdsRoute> = new Map();
  private networkScanner: NetworkScanner;
  private errorManager: ErrorManager;

  constructor(
    private config: ApiConfig,
    private mqttBroker: MqttBroker,
    private adsGateway: AdsGateway
  ) {
    this.app = express();
    this.auditLogger = new AuditLogger();
    this.networkScanner = new NetworkScanner();
    this.errorManager = new ErrorManager();
    this.startTime = Date.now();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandlers();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Serve static files from root directory
    this.app.use(express.static(path.join(__dirname, '..')));

    this.app.use((req: any, res: any, next: any) => {
      console.log(`[API] ${req.method} ${req.path}`);
      // Extract client info
      req.clientInfo = {
        userIp: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown') as string,
        userAgent: req.headers['user-agent'] || 'unknown'
      };
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (req: Request, res: Response) => {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const variables = this.adsGateway.getAllVariables();

      res.json({
        status: this.adsGateway.isConnected() ? 'online' : 'offline',
        uptime,
        timestamp: Date.now(),
        ads: {
          connected: this.adsGateway.isConnected(),
          variables: variables.length,
        },
        mqtt: {
          clients: this.mqttBroker.getClients(),
          subscriptions: this.mqttBroker.getSubscriptions(),
        },
      });
    });

    // Get all variables
    this.app.get('/api/variables', (req: Request, res: Response) => {
      const variables = this.adsGateway.getAllVariables();
      res.json(variables);
    });

    // Get specific variable
    this.app.get('/api/variables/:id', (req: Request, res: Response) => {
      const variable = this.adsGateway.getVariable(req.params.id);

      if (!variable) {
        return res.status(404).json({ error: 'Variable not found' });
      }

      res.json(variable);
    });

    // Add variable
    this.app.post('/api/variables', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      try {
        const { name, path, type, pollInterval = 100, mqttTopic } = req.body;

        if (!name || !path || !type) {
          this.auditLogger.log({
            action: 'CREATE',
            variableId: 'NEW',
            userId: req.headers['x-user-id'] as string,
            userIp: clientInfo.userIp,
            userAgent: clientInfo.userAgent,
            details: 'Missing required fields',
            status: 'FAILED',
          });
          return res.status(400).json({
            error: 'Missing required fields: name, path, type',
          });
        }

        const variable: AdsVariable = {
          id: uuidv4(),
          name,
          path,
          type,
          pollInterval,
          mqttTopic: mqttTopic || `ads/${name.toLowerCase()}/value`,
        };

        await this.adsGateway.addVariable(variable);

        this.auditLogger.log({
          action: 'CREATE',
          variableId: variable.id,
          variableName: name,
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Created variable: ${name} at ${path}`,
          status: 'SUCCESS',
        });

        res.status(201).json(variable);
      } catch (error: any) {
        this.auditLogger.log({
          action: 'CREATE',
          variableId: 'NEW',
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({
          error: error.message,
        });
      }
    });

    // Remove variable
    this.app.delete('/api/variables/:id', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      try {
        const variable = this.adsGateway.getVariable(req.params.id);

        if (!variable) {
          this.auditLogger.log({
            action: 'DELETE',
            variableId: req.params.id,
            userId: req.headers['x-user-id'] as string,
            userIp: clientInfo.userIp,
            userAgent: clientInfo.userAgent,
            details: 'Variable not found',
            status: 'FAILED',
          });
          return res.status(404).json({ error: 'Variable not found' });
        }

        await this.adsGateway.removeVariable(req.params.id);

        this.auditLogger.log({
          action: 'DELETE',
          variableId: req.params.id,
          variableName: variable.name,
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Deleted variable: ${variable.name}`,
          status: 'SUCCESS',
        });

        res.json({ success: true, variable });
      } catch (error: any) {
        this.auditLogger.log({
          action: 'DELETE',
          variableId: req.params.id,
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: error.message });
      }
    });

    // Publish message
    this.app.post('/api/publish', (req: Request, res: Response) => {
      try {
        const { topic, payload, retain = false } = req.body;

        if (!topic || !payload) {
          return res.status(400).json({
            error: 'Missing required fields: topic, payload',
          });
        }

        const payloadStr =
          typeof payload === 'string' ? payload : JSON.stringify(payload);

        this.mqttBroker.publish(topic, payloadStr, { retain });

        res.json({
          success: true,
          topic,
          message: 'Published',
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Swagger/OpenAPI stub
    this.app.get('/api/docs', (req: Request, res: Response) => {
      res.json({
        title: 'ADS-MQTT Broker API',
        version: '1.0.0',
        endpoints: [
          { method: 'GET', path: '/api/health' },
          { method: 'GET', path: '/api/variables' },
          { method: 'GET', path: '/api/variables/:id' },
          { method: 'POST', path: '/api/variables' },
          { method: 'DELETE', path: '/api/variables/:id' },
          { method: 'POST', path: '/api/publish' },
          { method: 'GET', path: '/api/audit/logs' },
          { method: 'GET', path: '/api/audit/logs/variable/:id' },
          { method: 'GET', path: '/api/audit/stats' },
        ],
      });
    });

    // Audit Logs endpoints
    this.app.get('/api/audit/logs', (req: Request, res: Response) => {
      const limit = parseInt((req.query.limit as string) || '100');
      const logs = this.auditLogger.getAllLogs(limit);
      res.json(logs);
    });

    this.app.get('/api/audit/logs/variable/:variableId', (req: Request, res: Response) => {
      const limit = parseInt((req.query.limit as string) || '100');
      const logs = this.auditLogger.getVariableHistory(req.params.variableId, limit);
      res.json(logs);
    });

    this.app.get('/api/audit/logs/user/:userId', (req: Request, res: Response) => {
      const limit = parseInt((req.query.limit as string) || '100');
      const logs = this.auditLogger.getLogsByUser(req.params.userId, limit);
      res.json(logs);
    });

    this.app.get('/api/audit/stats', (req: Request, res: Response) => {
      const stats = this.auditLogger.getStats();
      res.json(stats);
    });

    // ADS Routes Management
    this.app.get('/api/ads/routes', (req: Request, res: Response) => {
      const routes = Array.from(this.adsRoutes.values());
      res.json(routes);
    });

    this.app.get('/api/ads/routes/:id', (req: Request, res: Response) => {
      const route = this.adsRoutes.get(req.params.id);
      if (!route) {
        return res.status(404).json({ error: 'Route not found' });
      }
      res.json(route);
    });

    this.app.post('/api/ads/routes', async (req: Request, res: Response) => {
      try {
        const { name, netId, ipAddress, port, description } = req.body;
        
        if (!name || !netId || !ipAddress || !port) {
          return res.status(400).json({ 
            error: 'Missing required fields: name, netId, ipAddress, port' 
          });
        }

        const route: AdsRoute = {
          id: uuidv4(),
          name,
          netId,
          ipAddress,
          port: parseInt(port),
          description,
          active: false
        };

        this.adsRoutes.set(route.id, route);

        // Log the action
        this.auditLogger.log({
          action: 'CREATE_ROUTE',
          userId: (req as any).clientInfo?.userIp || 'unknown',
          details: `Created ADS route ${route.name} (${route.netId} -> ${route.ipAddress}:${route.port})`,
          status: 'SUCCESS'
        });

        res.status(201).json(route);
      } catch (error: any) {
        this.auditLogger.log({
          action: 'CREATE_ROUTE',
          userId: (req as any).clientInfo?.userIp || 'unknown',
          details: `Failed to create route: ${error.message}`,
          status: 'FAILED'
        });
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/ads/routes/:id', async (req: Request, res: Response) => {
      try {
        const route = this.adsRoutes.get(req.params.id);
        if (!route) {
          return res.status(404).json({ error: 'Route not found' });
        }

        this.adsRoutes.delete(req.params.id);

        this.auditLogger.log({
          action: 'DELETE_ROUTE',
          userId: (req as any).clientInfo?.userIp || 'unknown',
          details: `Deleted ADS route ${route.name}`,
          status: 'SUCCESS'
        });

        res.json({ success: true, message: 'Route deleted' });
      } catch (error: any) {
        this.auditLogger.log({
          action: 'DELETE_ROUTE',
          userId: (req as any).clientInfo?.userIp || 'unknown',
          details: `Failed to delete route: ${error.message}`,
          status: 'FAILED'
        });
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/ads/routes/:id/test', async (req: Request, res: Response) => {
      try {
        const route = this.adsRoutes.get(req.params.id);
        if (!route) {
          return res.status(404).json({ error: 'Route not found' });
        }

        // TODO: Implement actual connection test
        // For now, simulate a test
        const success = true; // Simulate success

        this.auditLogger.log({
          action: 'TEST_ROUTE',
          userId: (req as any).clientInfo?.userIp || 'unknown',
          details: `Tested connection to ${route.name}`,
          status: success ? 'SUCCESS' : 'FAILED'
        });

        res.json({ 
          success, 
          message: success ? 'Connection successful' : 'Connection failed',
          route: route.name
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message, success: false });
      }
    });

    // Get network information
    this.app.get('/api/network/info', (req: Request, res: Response) => {
      try {
        const clientInfo = (req as any).clientInfo;
        const clientIp = clientInfo?.userIp || 'unknown';
        
        // Extract network from client IP
        let network = '192.168.1.0/24'; // Default fallback
        
        if (clientIp && clientIp !== 'unknown' && clientIp !== '::1' && clientIp !== '127.0.0.1') {
          // Remove IPv6 prefix if present
          let ip = clientIp.replace(/^::ffff:/, '');
          
          // Parse IP and create network range
          const parts = ip.split('.');
          if (parts.length === 4) {
            network = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          }
        }

        res.json({
          success: true,
          clientIp: clientIp === '::1' || clientIp === '127.0.0.1' ? 'localhost' : clientIp,
          network: network
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message, success: false });
      }
    });

    // Network Scanner for ADS devices (Server-Sent Events for live progress)
    this.app.post('/api/ads/scan', async (req: Request, res: Response) => {
      try {
        let { network, autoDetect, quickScan, fullPortScan } = req.body;
        
        // Auto-detect network from client IP
        if (autoDetect) {
          const clientInfo = (req as any).clientInfo;
          const clientIp = clientInfo?.userIp || '';
          
          if (clientIp && clientIp !== 'unknown' && clientIp !== '::1' && clientIp !== '127.0.0.1') {
            let ip = clientIp.replace(/^::ffff:/, '');
            const parts = ip.split('.');
            if (parts.length === 4) {
              network = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
            }
          } else {
            network = '192.168.3.0/24'; // Fallback for localhost - use your actual network
          }
        }
        
        if (!network) {
          return res.status(400).json({ error: 'Network parameter required or enable autoDetect' });
        }

        console.log(`[REST API] Starting network scan on ${network} (quickScan: ${quickScan}, fullPortScan: ${fullPortScan})`);

        // Setup Server-Sent Events for live progress updates
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const configuredRoutes = Array.from(this.adsRoutes.values());

        // Helper to enrich devices with configuration status
        const enrichDevice = (device: any) => {
          const existingRoute = configuredRoutes.find(
            route => route.ipAddress === device.ipAddress || route.netId === device.netId
          );
          
          return {
            ...device,
            isConfigured: !!existingRoute,
            configuredRouteName: existingRoute?.name,
            configuredRouteId: existingRoute?.id
          };
        };

        // Progress callback for live updates
        const onProgress = (progress: { scanned: number, total: number, found: number, devices: any[] }) => {
          const enrichedDevices = progress.devices.map(enrichDevice);
          const progressData = {
            ...progress,
            devices: enrichedDevices,
            network,
            configuredCount: enrichedDevices.filter(d => d.isConfigured).length
          };
          res.write(`data: ${JSON.stringify(progressData)}\n\n`);
        };

        // Perform actual network scan with progress callback
        let devices;
        if (quickScan) {
          devices = await this.networkScanner.quickScan(network);
        } else {
          devices = await this.networkScanner.scanNetwork(network, fullPortScan || false, 50, onProgress);
        }

        // Send final results
        const enrichedDevices = devices.map(enrichDevice);
        const finalData = {
          success: true,
          network,
          devices: enrichedDevices,
          message: `Found ${devices.length} device(s)`,
          configuredCount: enrichedDevices.filter(d => d.isConfigured).length,
          complete: true
        };
        
        res.write(`data: ${JSON.stringify(finalData)}\n\n`);
        res.end();

        this.auditLogger.log({
          action: 'CREATE_ROUTE',
          userId: (req as any).clientInfo?.userIp || 'unknown',
          details: `Network scan performed on ${network}, found ${devices.length} device(s)`,
          status: 'SUCCESS'
        });

      } catch (error: any) {
        console.error('[REST API] Network scan failed:', error);
        
        // Send error via SSE
        const errorData = {
          success: false,
          error: error.message,
          devices: [],
          complete: true
        };
        res.write(`data: ${JSON.stringify(errorData)}\n\n`);
        res.end();

        this.auditLogger.log({
          action: 'CREATE_ROUTE',
          userId: (req as any).clientInfo?.userIp || 'unknown',
          details: `Network scan failed: ${error.message}`,
          status: 'FAILED'
        });
      }
    });

    // Error Management endpoints
    this.app.get('/api/errors', (req: Request, res: Response) => {
      const includeResolved = req.query.includeResolved === 'true';
      const errors = this.errorManager.getAllErrors(includeResolved);
      res.json({
        success: true,
        errors,
        unresolvedCount: this.errorManager.getUnresolvedCount()
      });
    });

    this.app.post('/api/errors/:id/resolve', (req: Request, res: Response) => {
      this.errorManager.resolveError(req.params.id);
      res.json({ success: true });
    });

    this.app.delete('/api/errors', (req: Request, res: Response) => {
      this.errorManager.clearAllErrors();
      res.json({ success: true });
    });

    // Symbol Discovery Endpoints
    this.app.get('/api/symbols/discovered', (req: Request, res: Response) => {
      const discovery = this.adsGateway.getSymbolDiscovery();
      if (!discovery) {
        return res.status(503).json({
          success: false,
          error: 'Symbol discovery not initialized'
        });
      }

      const symbols = discovery.getDiscoveredSymbols();
      res.json({
        success: true,
        symbols,
        count: symbols.length
      });
    });

    this.app.post('/api/symbols/discover', async (req: Request, res: Response) => {
      try {
        await this.adsGateway.triggerSymbolDiscovery();
        res.json({
          success: true,
          message: 'Symbol discovery triggered'
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
  }

  private setupErrorHandlers(): void {
    // Listen for ADS Gateway errors
    this.adsGateway.on('error', (error: Error) => {
      this.errorManager.addError({
        level: 'error',
        source: 'ADS Gateway',
        message: error.message,
        details: error
      });
    });

    // Listen for symbol discovery events
    this.adsGateway.on('online-change-detected', (data) => {
      console.log(`[REST API] OnlineChange detected: ${data.symbolCount} symbols found`);
    });

    this.adsGateway.on('variables-auto-added', (data) => {
      console.log(`[REST API] ${data.variables.length} variables auto-added after OnlineChange`);
    });

    this.adsGateway.on('discovery-error', (data) => {
      this.errorManager.addError({
        level: 'warning',
        source: 'Symbol Discovery',
        message: 'Failed to discover symbols',
        details: data.error
      });
    });

    // Listen for MQTT Broker errors
    this.mqttBroker.on('error', (error: Error) => {
      this.errorManager.addError({
        level: 'error',
        source: 'MQTT Broker',
        message: error.message,
        details: error
      });
    });
  }

  start(): void {
    this.app.listen(this.config.port, this.config.host, () => {
      console.log(`[REST API] Started on http://${this.config.host}:${this.config.port}`);
    });
  }

  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }
}
