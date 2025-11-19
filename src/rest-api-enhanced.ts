import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { MqttBroker } from './mqtt-broker';
import { AdsGateway } from './ads-gateway';
import { AuditLogger } from './audit-logger';

export interface RestApiConfig {
  port: number;
  brokerPort?: number;
}

export interface Variable {
  id: string;
  name: string;
  path: string;
  type: string;
  value: any;
  pollInterval: number;
  lastUpdate: Date;
  registeredBy: {
    userId?: string;
    userIp: string;
    userAgent?: string;
    timestamp: Date;
  };
}

export class RestApi {
  private app: Application;
  private config: RestApiConfig;
  private variables: Map<string, Variable> = new Map();
  private broker: MqttBroker;
  private adsGateway: AdsGateway;
  private auditLogger: AuditLogger;

  constructor(config: RestApiConfig, broker: MqttBroker, adsGateway: AdsGateway) {
    this.config = config;
    this.broker = broker;
    this.adsGateway = adsGateway;
    this.auditLogger = new AuditLogger();
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(this.extractClientInfo.bind(this));
  }

  private extractClientInfo(req: Request, res: Response, next: express.NextFunction) {
    const userIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown') as string;
    const userAgent = req.headers['user-agent'] || 'unknown';
    (req as any).clientInfo = { userIp, userAgent };
    next();
  }

  private setupRoutes() {
    // Health endpoint
    this.app.get('/api/health', (req: Request, res: Response) => {
      res.json({
        status: 'OK',
        timestamp: new Date(),
        uptime: process.uptime(),
        clients: this.broker.getClients(),
        variables: this.variables.size,
        brokerPort: this.config.brokerPort,
        apiPort: this.config.port,
      });
    });

    // List all variables with registration info
    this.app.get('/api/variables', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const variables = Array.from(this.variables.values());
      
      this.auditLogger.log({
        action: 'READ',
        variableId: 'ALL',
        userId: req.headers['x-user-id'] as string,
        userIp: clientInfo.userIp,
        userAgent: clientInfo.userAgent,
        details: `Retrieved ${variables.length} variables`,
        status: 'SUCCESS',
      });

      res.json(variables);
    });

    // Get specific variable with history
    this.app.get('/api/variables/:id', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const variable = this.variables.get(req.params.id);

      if (!variable) {
        this.auditLogger.log({
          action: 'READ',
          variableId: req.params.id,
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Variable not found: ${req.params.id}`,
          status: 'FAILED',
        });
        return res.status(404).json({ error: 'Variable not found' });
      }

      const history = this.auditLogger.getVariableHistory(req.params.id, 50);

      this.auditLogger.log({
        action: 'READ',
        variableId: req.params.id,
        variableName: variable.name,
        userId: req.headers['x-user-id'] as string,
        userIp: clientInfo.userIp,
        userAgent: clientInfo.userAgent,
        details: `Retrieved variable: ${variable.name}`,
        status: 'SUCCESS',
      });

      res.json({ variable, history });
    });

    // Create new variable
    this.app.post('/api/variables', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const { name, path, type, pollInterval } = req.body;

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
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const id = uuidv4();
      const variable: Variable = {
        id,
        name,
        path,
        type,
        value: null,
        pollInterval: pollInterval || 1000,
        lastUpdate: new Date(),
        registeredBy: {
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          timestamp: new Date(),
        },
      };

      this.variables.set(id, variable);
      this.adsGateway.addVariable({
        id,
        name,
        path,
        type,
        pollInterval: pollInterval || 1000,
        mqttTopic: `variables/${id}`,
      });

      this.auditLogger.log({
        action: 'CREATE',
        variableId: id,
        variableName: name,
        userId: req.headers['x-user-id'] as string,
        userIp: clientInfo.userIp,
        userAgent: clientInfo.userAgent,
        details: `Created variable: ${name} at ${path}`,
        status: 'SUCCESS',
      });

      res.status(201).json(variable);
    });

    // Update variable value
    this.app.put('/api/variables/:id', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const { value } = req.body;
      const variable = this.variables.get(req.params.id);

      if (!variable) {
        this.auditLogger.log({
          action: 'UPDATE',
          variableId: req.params.id,
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: 'Variable not found',
          status: 'FAILED',
        });
        return res.status(404).json({ error: 'Variable not found' });
      }

      const oldValue = variable.value;
      variable.value = value;
      variable.lastUpdate = new Date();

      this.auditLogger.log({
        action: 'VALUE_CHANGE',
        variableId: req.params.id,
        variableName: variable.name,
        userId: req.headers['x-user-id'] as string,
        userIp: clientInfo.userIp,
        userAgent: clientInfo.userAgent,
        oldValue,
        newValue: value,
        details: `Updated value: ${variable.name} from ${oldValue} to ${value}`,
        status: 'SUCCESS',
      });

      this.broker.publish(`variables/${req.params.id}`, JSON.stringify(variable));
      res.json(variable);
    });

    // Delete variable
    this.app.delete('/api/variables/:id', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const variable = this.variables.get(req.params.id);

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

      this.variables.delete(req.params.id);

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

      res.json({ message: 'Variable deleted' });
    });

    // Publish MQTT message
    this.app.post('/api/publish', (req: Request, res: Response) => {
      const clientInfo = (req as any).clientInfo;
      const { topic, message } = req.body;

      if (!topic || !message) {
        return res.status(400).json({ error: 'Missing topic or message' });
      }

      try {
        this.broker.publish(topic, message);

        this.auditLogger.log({
          action: 'CREATE',
          variableId: topic,
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Published message to ${topic}`,
          status: 'SUCCESS',
        });

        res.json({ success: true });
      } catch (error) {
        this.auditLogger.log({
          action: 'CREATE',
          variableId: topic,
          userId: req.headers['x-user-id'] as string,
          userIp: clientInfo.userIp,
          userAgent: clientInfo.userAgent,
          details: `Failed to publish message to ${topic}: ${error}`,
          status: 'FAILED',
        });
        res.status(500).json({ error: 'Failed to publish' });
      }
    });

    // Audit log endpoints
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

    this.app.get('/api/audit/logs/action/:action', (req: Request, res: Response) => {
      const limit = parseInt((req.query.limit as string) || '100');
      const action = req.params.action as any;
      const logs = this.auditLogger.getLogsByAction(action, limit);
      res.json(logs);
    });

    this.app.get('/api/audit/stats', (req: Request, res: Response) => {
      const stats = this.auditLogger.getStats();
      res.json(stats);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.app.listen(this.config.port, () => {
          console.log(`🌐 REST API running on port ${this.config.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }
}
