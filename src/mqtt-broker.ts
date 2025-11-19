import aedes from 'aedes';
import { createServer } from 'net';
import { EventEmitter } from 'events';

export interface MqttBrokerConfig {
  port: number;
  host: string;
  clientIdPrefix?: string;
}

export class MqttBroker extends EventEmitter {
  private aedesInstance: any;
  private netServer: any;

  constructor(private config: MqttBrokerConfig) {
    super();
    this.aedesInstance = aedes({
      id: config.clientIdPrefix || 'mqtt_broker',
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.netServer = createServer(this.aedesInstance.handle);

      this.netServer.listen(this.config.port, this.config.host, () => {
        console.log(
          `[MQTT Broker] Started on ${this.config.host}:${this.config.port}`
        );
        this.setupHandlers();
        resolve();
      });

      this.netServer.on('error', reject);
    });
  }

  private setupHandlers(): void {
    this.aedesInstance.on('client', (client: any) => {
      console.log(`[MQTT] Client connected: ${client.id}`);
      this.emit('client-connected', client.id);
    });

    this.aedesInstance.on('clientDisconnect', (client: any) => {
      console.log(`[MQTT] Client disconnected: ${client.id}`);
      this.emit('client-disconnected', client.id);
    });

    this.aedesInstance.on('publish', (packet: any, client: any) => {
      if (client) {
        console.log(
          `[MQTT] Published to ${packet.topic}: ${packet.payload.toString()}`
        );
      }
    });

    this.aedesInstance.on('subscribe', (subscriptions: any, client: any) => {
      console.log(`[MQTT] Client ${client.id} subscribed to:`, subscriptions);
    });
  }

  publish(topic: string, payload: string | Buffer, options?: any): void {
    this.aedesInstance.publish(
      {
        topic,
        payload: typeof payload === 'string' ? Buffer.from(payload) : payload,
        qos: options?.qos || 0,
        retain: options?.retain || false,
      },
      (error: any) => {
        if (error) {
          console.error('[MQTT] Publish error:', error);
        }
      }
    );
  }

  subscribe(topic: string, callback: (topic: string, payload: Buffer) => void): void {
    // This is for internal subscriptions, not client subscriptions
    const internalSub = (packet: any, client: any) => {
      if (!client && packet.topic === topic) {
        callback(packet.topic, packet.payload);
      }
    };
    this.aedesInstance.on('publish', internalSub);
  }

  getClients(): number {
    return this.aedesInstance.clients.size;
  }

  getSubscriptions(): number {
    let count = 0;
    try {
      const clientsMap = this.aedesInstance.clients;
      if (clientsMap && typeof clientsMap.forEach === 'function') {
        clientsMap.forEach((client: any) => {
          if (client && client.subscriptions) {
            count += client.subscriptions.size || 0;
          }
        });
      }
    } catch (error) {
      console.warn('Error counting subscriptions:', error);
    }
    return count;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.aedesInstance.close(() => {
        this.netServer.close(() => {
          console.log('[MQTT Broker] Stopped');
          resolve();
        });
      });
    });
  }
}
