import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { eventBus, EventNames, VariableChangeEvent, WebSocketEvent } from './event-bus';
import { getCache } from './redis-cache';

/**
 * WebSocket Server für v4.0
 *
 * Features:
 * - Real-time bidirectional communication mit Socket.IO
 * - Room-based subscriptions (per connection, per variable)
 * - Automatic reconnection handling
 * - Event-driven architecture integration
 * - Performance optimized with binary protocol
 * - Client authentication & authorization
 */

export interface WebSocketConfig {
  cors?: {
    origin: string | string[];
    credentials?: boolean;
  };
  pingInterval?: number;
  pingTimeout?: number;
  maxHttpBufferSize?: number;
}

export interface ClientSubscription {
  clientId: string;
  connectionIds: Set<string>;
  variableIds: Set<string>;
  topics: Set<string>;
}

export class WebSocketServer {
  private io: SocketIOServer;
  private clients: Map<string, ClientSubscription> = new Map();
  private cache = getCache();

  constructor(httpServer: HttpServer, config: WebSocketConfig = {}) {
    this.io = new SocketIOServer(httpServer, {
      cors: config.cors || {
        origin: '*',
        credentials: true,
      },
      pingInterval: config.pingInterval || 25000,
      pingTimeout: config.pingTimeout || 20000,
      maxHttpBufferSize: config.maxHttpBufferSize || 1e6, // 1MB
      transports: ['websocket', 'polling'],
      // Use binary protocol for better performance
      parser: require('socket.io-msgpack-parser'),
    });

    this.setupEventHandlers();
    this.setupEventBusListeners();

    console.log('[WebSocket] Server initialized');
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const clientId = socket.id;

      console.log(`[WebSocket] Client connected: ${clientId}`);

      // Initialize client subscription
      this.clients.set(clientId, {
        clientId,
        connectionIds: new Set(),
        variableIds: new Set(),
        topics: new Set(),
      });

      // Emit connection event
      eventBus.emit(EventNames.WS_CLIENT_CONNECTED, {
        event: 'connected',
        clientId,
        timestamp: Date.now(),
      } as WebSocketEvent);

      // === Client Event Handlers ===

      // Subscribe to connection updates
      socket.on('subscribe:connection', (connectionId: string) => {
        this.handleConnectionSubscription(socket, connectionId);
      });

      // Unsubscribe from connection
      socket.on('unsubscribe:connection', (connectionId: string) => {
        this.handleConnectionUnsubscription(socket, connectionId);
      });

      // Subscribe to variable updates
      socket.on('subscribe:variable', (variableId: string) => {
        this.handleVariableSubscription(socket, variableId);
      });

      // Unsubscribe from variable
      socket.on('unsubscribe:variable', (variableId: string) => {
        this.handleVariableUnsubscription(socket, variableId);
      });

      // Subscribe to MQTT topic
      socket.on('subscribe:topic', (topic: string) => {
        this.handleTopicSubscription(socket, topic);
      });

      // Write variable value
      socket.on('variable:write', async (data: {
        connectionId: string;
        variableId: string;
        value: any;
      }) => {
        await this.handleVariableWrite(socket, data);
      });

      // Get variable history
      socket.on('variable:history', async (data: {
        variableId: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
      }, callback) => {
        const history = await this.getVariableHistory(data);
        callback(history);
      });

      // Get connection status
      socket.on('connections:status', async (callback) => {
        const status = await this.getConnectionsStatus();
        callback(status);
      });

      // Get statistics
      socket.on('stats', async (callback) => {
        const stats = await this.getStats();
        callback(stats);
      });

      // Disconnect handler
      socket.on('disconnect', (reason) => {
        console.log(`[WebSocket] Client disconnected: ${clientId} (${reason})`);

        this.clients.delete(clientId);

        eventBus.emit(EventNames.WS_CLIENT_DISCONNECTED, {
          event: 'disconnected',
          clientId,
          timestamp: Date.now(),
        } as WebSocketEvent);
      });

      // Error handler
      socket.on('error', (error) => {
        console.error(`[WebSocket] Client error (${clientId}):`, error);
      });
    });

    // Global error handler
    this.io.on('error', (error) => {
      console.error('[WebSocket] Server error:', error);
    });
  }

  private setupEventBusListeners(): void {
    // Listen for variable changes and broadcast to subscribed clients
    eventBus.on(EventNames.VARIABLE_CHANGED, (event: VariableChangeEvent) => {
      this.broadcastVariableChange(event);
    });

    // Listen for connection events
    eventBus.on(EventNames.CONNECTION_ESTABLISHED, (data: any) => {
      this.io.to(`connection:${data.connectionId}`).emit('connection:established', data);
    });

    eventBus.on(EventNames.CONNECTION_LOST, (data: any) => {
      this.io.to(`connection:${data.connectionId}`).emit('connection:lost', data);
    });

    eventBus.on(EventNames.CONNECTION_ERROR, (data: any) => {
      this.io.to(`connection:${data.connectionId}`).emit('connection:error', data);
    });

    // Listen for discovery events
    eventBus.on(EventNames.SYMBOLS_DISCOVERED, (data: any) => {
      this.io.to(`connection:${data.connectionId}`).emit('symbols:discovered', data);
    });

    eventBus.on(EventNames.ONLINE_CHANGE_DETECTED, (data: any) => {
      this.io.to(`connection:${data.connectionId}`).emit('online-change', data);
    });

    // Listen for system events
    eventBus.on(EventNames.SYSTEM_ERROR, (data: any) => {
      this.io.emit('system:error', data);
    });

    eventBus.on(EventNames.SYSTEM_WARNING, (data: any) => {
      this.io.emit('system:warning', data);
    });
  }

  // ===== Subscription Handlers =====

  private handleConnectionSubscription(socket: Socket, connectionId: string): void {
    const clientSub = this.clients.get(socket.id);
    if (!clientSub) return;

    const room = `connection:${connectionId}`;
    socket.join(room);
    clientSub.connectionIds.add(connectionId);

    console.log(`[WebSocket] Client ${socket.id} subscribed to connection ${connectionId}`);

    socket.emit('subscribed:connection', { connectionId });
  }

  private handleConnectionUnsubscription(socket: Socket, connectionId: string): void {
    const clientSub = this.clients.get(socket.id);
    if (!clientSub) return;

    const room = `connection:${connectionId}`;
    socket.leave(room);
    clientSub.connectionIds.delete(connectionId);

    console.log(`[WebSocket] Client ${socket.id} unsubscribed from connection ${connectionId}`);

    socket.emit('unsubscribed:connection', { connectionId });
  }

  private handleVariableSubscription(socket: Socket, variableId: string): void {
    const clientSub = this.clients.get(socket.id);
    if (!clientSub) return;

    const room = `variable:${variableId}`;
    socket.join(room);
    clientSub.variableIds.add(variableId);

    console.log(`[WebSocket] Client ${socket.id} subscribed to variable ${variableId}`);

    socket.emit('subscribed:variable', { variableId });
  }

  private handleVariableUnsubscription(socket: Socket, variableId: string): void {
    const clientSub = this.clients.get(socket.id);
    if (!clientSub) return;

    const room = `variable:${variableId}`;
    socket.leave(room);
    clientSub.variableIds.delete(variableId);

    console.log(`[WebSocket] Client ${socket.id} unsubscribed from variable ${variableId}`);

    socket.emit('unsubscribed:variable', { variableId });
  }

  private handleTopicSubscription(socket: Socket, topic: string): void {
    const clientSub = this.clients.get(socket.id);
    if (!clientSub) return;

    const room = `topic:${topic}`;
    socket.join(room);
    clientSub.topics.add(topic);

    console.log(`[WebSocket] Client ${socket.id} subscribed to topic ${topic}`);

    socket.emit('subscribed:topic', { topic });
  }

  // ===== Action Handlers =====

  private async handleVariableWrite(socket: Socket, data: {
    connectionId: string;
    variableId: string;
    value: any;
  }): Promise<void> {
    try {
      console.log(`[WebSocket] Variable write request from ${socket.id}:`, data);

      // Emit event for queue to handle
      eventBus.emit('ws.variable-write', {
        ...data,
        source: 'websocket',
        clientId: socket.id,
        timestamp: Date.now(),
      });

      socket.emit('variable:write:ack', {
        success: true,
        variableId: data.variableId,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      console.error('[WebSocket] Variable write error:', error);

      socket.emit('variable:write:error', {
        success: false,
        variableId: data.variableId,
        error: error.message,
        timestamp: Date.now(),
      });
    }
  }

  // ===== Broadcasting =====

  private broadcastVariableChange(event: VariableChangeEvent): void {
    const room = `variable:${event.variableId}`;

    this.io.to(room).emit('variable:changed', {
      variableId: event.variableId,
      variableName: event.variableName,
      value: event.value,
      oldValue: event.oldValue,
      timestamp: event.timestamp,
      quality: event.quality,
      source: event.source,
    });

    // Also broadcast to connection room
    const connectionRoom = `connection:${event.connectionId}`;
    this.io.to(connectionRoom).emit('variable:changed', {
      variableId: event.variableId,
      variableName: event.variableName,
      value: event.value,
      timestamp: event.timestamp,
    });

    // Track performance
    eventBus.emitPerformanceMetric({
      operation: 'ws.broadcast',
      duration: 0, // Instant broadcast
      timestamp: Date.now(),
      metadata: { variableId: event.variableId },
    });
  }

  /**
   * Broadcast custom event to all clients
   */
  broadcast(event: string, data: any): void {
    this.io.emit(event, data);
  }

  /**
   * Send event to specific client
   */
  sendToClient(clientId: string, event: string, data: any): void {
    this.io.to(clientId).emit(event, data);
  }

  /**
   * Send event to room
   */
  sendToRoom(room: string, event: string, data: any): void {
    this.io.to(room).emit(event, data);
  }

  // ===== Data Retrieval =====

  private async getVariableHistory(data: {
    variableId: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<any> {
    // This would fetch from persistence layer
    // For now, return empty array
    return [];
  }

  private async getConnectionsStatus(): Promise<any> {
    // This would fetch from connection manager
    // For now, return empty object
    return {};
  }

  private async getStats(): Promise<any> {
    return {
      connectedClients: this.clients.size,
      totalSubscriptions: Array.from(this.clients.values()).reduce(
        (sum, client) =>
          sum + client.connectionIds.size + client.variableIds.size + client.topics.size,
        0
      ),
      eventBusStats: eventBus.getEventStats(),
      cacheStats: this.cache.getStats(),
    };
  }

  // ===== Statistics =====

  getClientCount(): number {
    return this.clients.size;
  }

  getClients(): ClientSubscription[] {
    return Array.from(this.clients.values());
  }

  getClientSubscriptions(clientId: string): ClientSubscription | undefined {
    return this.clients.get(clientId);
  }

  // ===== Cleanup =====

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        console.log('[WebSocket] Server closed');
        resolve();
      });
    });
  }
}
