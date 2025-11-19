import express, { Request, Response } from 'express';
import cors from 'cors';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AdsGateway, AdsVariable } from './ads-gateway';
import { MqttBroker } from './mqtt-broker';
import { AuditLogger } from './audit-logger';
import { PersistenceLayer } from './persistence';
import { MonitoringService } from './monitoring';

export interface ApiConfig {
  port: number;
  host: string;
}

export class RestApiV2 {
  private app: express.Application;
  private startTime: number;
  private auditLogger: AuditLogger;
  private persistence: PersistenceLayer;
  private monitoring: MonitoringService;

  constructor(
    private config: ApiConfig,
    private mqttBroker: MqttBroker,
    private adsGateway: AdsGateway
  ) {
    this.app = express();
    this.auditLogger = new AuditLogger();
    this.persistence = new PersistenceLayer();
    this.monitoring = new MonitoringService(this.persistence);
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

    // Listen to ADS Gateway events and persist variable changes
    this.adsGateway.on('variable-changed', (variable: any) => {
      try {
        this.persistence.saveVariableValue({
          variableId: variable.id,
          variableName: variable.name,
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
          details: `Value changed to ${variable.value}`,
          status: 'SUCCESS',
          newValue: variable.value
        });
      } catch (error) {
        console.error('[REST API] Failed to persist variable change:', error);
      }
    });

    // Update monitoring metrics
    this.adsGateway.on('variable-added', () => {
      this.updateAdsMetrics();
    });

    this.adsGateway.on('variable-error', () => {
      this.monitoring.incrementAdsError();
    });
  }

  private updateAdsMetrics(): void {
    const variables = this.adsGateway.getAllVariables();
    this.monitoring.updateAdsMetrics({
      totalVariables: variables.length,
      activePolls: variables.length,
      connected: this.adsGateway.isConnected()
    });
  }

  private setupRoutes(): void {
    // ===== Health & Status =====

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

    this.app.get('/api/monitoring/summary', (req: Request, res: Response) => {
      // Cache für 2 Sekunden um Last zu reduzieren
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

      const validTypes = ['cpu', 'memory', 'mqtt_clients', 'mqtt_messages', 'ads_errors', 'api_requests'];

      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: 'Invalid metric type' });
      }

      const metrics = this.monitoring.getHistoricalMetrics(
        type as any,
        startTime,
        endTime,
        limit
      );

      res.json(metrics);
    });

    // ===== Variables =====

    this.app.get('/api/variables', (req: Request, res: Response) => {
      const variables = this.adsGateway.getAllVariables();
      res.json(variables);
    });

    this.app.get('/api/variables/:id', (req: Request, res: Response) => {
      const variable = this.adsGateway.getVariable(req.params.id);

      if (!variable) {
        return res.status(404).json({ error: 'Variable not found' });
      }

      res.json(variable);
    });

    this.app.get('/api/variables/:id/history', (req: Request, res: Response) => {
      const { id } = req.params;
      const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
      const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 1000;

      const history = this.persistence.getVariableHistory(id, startTime, endTime, limit);
      res.json(history);
    });

    this.app.get('/api/variables/:id/statistics', (req: Request, res: Response) => {
      const { id } = req.params;
      const stats = this.persistence.getVariableStatistics(id);

      if (!stats) {
        return res.status(404).json({ error: 'No statistics available' });
      }

      res.json(stats);
    });

    this.app.get('/api/variables/statistics/all', (req: Request, res: Response) => {
      const stats = this.persistence.getAllVariableStatistics();
      res.json(stats);
    });

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

        this.updateAdsMetrics();

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

        this.updateAdsMetrics();

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

    // ===== MQTT Publishing =====

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

    // ===== Audit Logs =====

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

    // ===== ADS Configuration =====

    this.app.get('/api/ads/config', (req: Request, res: Response) => {
      res.json({
        host: process.env.ADS_HOST || 'localhost',
        port: parseInt(process.env.ADS_PORT || '48898'),
        targetIp: process.env.ADS_TARGET_IP || '127.0.0.1',
        targetPort: parseInt(process.env.ADS_TARGET_PORT || '801'),
        sourcePort: parseInt(process.env.ADS_SOURCE_PORT || '32750'),
        connected: this.adsGateway.isConnected()
      });
    });

    this.app.post('/api/ads/config', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const { host, port, targetIp, targetPort, sourcePort } = req.body;

      try {
        // Validate input
        if (host) process.env.ADS_HOST = host;
        if (port) process.env.ADS_PORT = String(port);
        if (targetIp) process.env.ADS_TARGET_IP = targetIp;
        if (targetPort) process.env.ADS_TARGET_PORT = String(targetPort);
        if (sourcePort) process.env.ADS_SOURCE_PORT = String(sourcePort);

        this.auditLogger.log({
          action: 'UPDATE',
          variableId: 'ADS_CONFIG',
          variableName: 'ADS Configuration',
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Updated ADS config: ${host}:${port}`,
          status: 'SUCCESS',
        });

        res.json({
          success: true,
          message: 'ADS configuration updated. Restart required to apply changes.',
          config: {
            host: process.env.ADS_HOST,
            port: process.env.ADS_PORT,
            targetIp: process.env.ADS_TARGET_IP,
            targetPort: process.env.ADS_TARGET_PORT,
            sourcePort: process.env.ADS_SOURCE_PORT
          }
        });
      } catch (error: any) {
        this.auditLogger.log({
          action: 'UPDATE',
          variableId: 'ADS_CONFIG',
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed to update ADS config: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/ads/reconnect', async (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;

      try {
        await this.adsGateway.disconnect();
        await this.adsGateway.connect();

        this.auditLogger.log({
          action: 'UPDATE',
          variableId: 'ADS_RECONNECT',
          variableName: 'ADS Reconnect',
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: 'ADS Gateway reconnected',
          status: 'SUCCESS',
        });

        res.json({
          success: true,
          connected: this.adsGateway.isConnected()
        });
      } catch (error: any) {
        this.auditLogger.log({
          action: 'UPDATE',
          variableId: 'ADS_RECONNECT',
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed to reconnect: ${error.message}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: error.message });
      }
    });

    // ===== Persistence Management =====

    this.app.get('/api/persistence/stats', (req: Request, res: Response) => {
      const stats = this.persistence.getDatabaseStats();
      res.json(stats);
    });

    this.app.post('/api/persistence/cleanup', (req: Request, res: Response) => {
      const retentionDays = req.body.retentionDays || 30;

      try {
        this.persistence.cleanupOldData(retentionDays);
        res.json({ success: true, message: `Cleaned up data older than ${retentionDays} days` });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== API Documentation =====

    this.app.get('/api/docs', (req: Request, res: Response) => {
      res.json({
        title: 'ADS-MQTT Broker API v2',
        version: '2.0.0',
        endpoints: [
          { method: 'GET', path: '/api/health', description: 'System health check' },
          { method: 'GET', path: '/api/monitoring/summary', description: 'Complete monitoring summary' },
          { method: 'GET', path: '/api/monitoring/system', description: 'System health metrics' },
          { method: 'GET', path: '/api/monitoring/metrics/:type', description: 'Historical metrics by type' },
          { method: 'GET', path: '/api/variables', description: 'List all variables' },
          { method: 'GET', path: '/api/variables/:id', description: 'Get specific variable' },
          { method: 'GET', path: '/api/variables/:id/history', description: 'Get variable history' },
          { method: 'GET', path: '/api/variables/:id/statistics', description: 'Get variable statistics' },
          { method: 'GET', path: '/api/variables/statistics/all', description: 'Get all variables statistics' },
          { method: 'POST', path: '/api/variables', description: 'Create new variable' },
          { method: 'DELETE', path: '/api/variables/:id', description: 'Delete variable' },
          { method: 'POST', path: '/api/publish', description: 'Publish MQTT message' },
          { method: 'GET', path: '/api/ads/config', description: 'Get ADS configuration' },
          { method: 'POST', path: '/api/ads/config', description: 'Update ADS configuration' },
          { method: 'POST', path: '/api/ads/reconnect', description: 'Reconnect ADS Gateway' },
          { method: 'GET', path: '/api/audit/logs', description: 'Get audit logs' },
          { method: 'GET', path: '/api/audit/logs/variable/:id', description: 'Get variable audit history' },
          { method: 'GET', path: '/api/audit/logs/user/:userId', description: 'Get user audit logs' },
          { method: 'GET', path: '/api/audit/stats', description: 'Get audit statistics' },
          { method: 'GET', path: '/api/persistence/stats', description: 'Get database statistics' },
          { method: 'POST', path: '/api/persistence/cleanup', description: 'Cleanup old data' },
        ],
      });
    });
  }

  start(): void {
    // Start monitoring service
    this.monitoring.start();

    // Update MQTT metrics periodically
    setInterval(() => {
      this.monitoring.updateMqttMetrics({
        totalClients: this.mqttBroker.getClients(),
        totalSubscriptions: this.mqttBroker.getSubscriptions()
      });
    }, 5000);

    // Start HTTP server
    this.app.listen(this.config.port, this.config.host, () => {
      console.log(`[REST API v2] Started on http://${this.config.host}:${this.config.port}`);
      console.log(`[REST API v2] Admin Dashboard: http://${this.config.host}:${this.config.port}/admin-dashboard.html`);
      console.log(`[REST API v2] API Docs: http://${this.config.host}:${this.config.port}/api/docs`);
    });
  }

  stop(): void {
    this.monitoring.stop();
    this.persistence.close();
  }

  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  getPersistence(): PersistenceLayer {
    return this.persistence;
  }

  getMonitoring(): MonitoringService {
    return this.monitoring;
  }
}
