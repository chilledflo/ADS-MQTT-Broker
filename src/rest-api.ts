import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { AdsGateway, AdsVariable } from './ads-gateway';
import { MqttBroker } from './mqtt-broker';
import { AuditLogger } from './audit-logger';

export interface ApiConfig {
  port: number;
  host: string;
}

export class RestApi {
  private app: express.Application;
  private startTime: number;
  private auditLogger: AuditLogger;

  constructor(
    private config: ApiConfig,
    private mqttBroker: MqttBroker,
    private adsGateway: AdsGateway
  ) {
    this.app = express();
    this.auditLogger = new AuditLogger();
    this.startTime = Date.now();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

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
