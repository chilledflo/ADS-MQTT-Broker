import * as dotenv from 'dotenv';
import { MqttBroker } from './mqtt-broker';
import { AdsConnectionManager, AdsConnectionConfig } from './ads-connection-manager';
import { RestApiV3 } from './rest-api';

// Load environment variables
dotenv.config();

const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883');
const MQTT_HOST = process.env.MQTT_HOST || '0.0.0.0';
const API_PORT = parseInt(process.env.API_PORT || '8080');
const API_HOST = process.env.API_HOST || '0.0.0.0';

/**
 * ADS-MQTT Broker v3.0
 *
 * Features:
 * - Multiple ADS connections support
 * - Automatic symbol discovery from PLC
 * - OnlineChange detection and auto-refresh
 * - SQLite persistence for history
 * - Real-time monitoring
 * - Audit logging
 * - Advanced web dashboard
 */
async function main() {
  console.log('='.repeat(60));
  console.log('ADS-MQTT Broker v3.0 - Multi-Connection & Auto-Discovery');
  console.log('='.repeat(60));

  try {
    // Initialize MQTT Broker
    console.log('[Main] Initializing MQTT Broker...');
    const mqttBroker = new MqttBroker({ port: MQTT_PORT, host: MQTT_HOST });
    await mqttBroker.start();

    // Initialize ADS Connection Manager
    console.log('[Main] Initializing ADS Connection Manager...');
    const adsManager = new AdsConnectionManager();

    // Setup event handlers for connection manager
    adsManager.on('connection-established', (data) => {
      console.log(`[Main] ✓ Connection established: ${data.name}`);
    });

    adsManager.on('connection-error', (data) => {
      console.error(`[Main] ✗ Connection error on ${data.name}:`, data.error);
    });

    adsManager.on('online-change-detected', (data) => {
      console.log(`[Main] 🔄 OnlineChange detected on connection ${data.connectionId} (version ${data.version})`);
      console.log(`[Main]    Found ${data.symbolCount} symbols`);
    });

    adsManager.on('symbols-discovered', (data) => {
      console.log(`[Main] 📊 Symbols discovered on ${data.connectionId}:`);
      console.log(`[Main]    Total: ${data.total}, Filtered: ${data.filtered}`);
    });

    adsManager.on('variables-auto-added', (data) => {
      console.log(`[Main] ✓ Auto-added ${data.variables.length} variables on ${data.connectionId}`);
    });

    adsManager.on('variable-changed', (data) => {
      const { connectionId, variable } = data;
      // Publish to MQTT
      mqttBroker.publish(variable.mqttTopic, JSON.stringify({
        value: variable.value,
        timestamp: variable.timestamp,
        connection: connectionId
      }));
    });

    // Add default ADS connection from environment if configured
    if (process.env.ADS_HOST && process.env.ADS_TARGET_IP) {
      console.log('[Main] Adding default ADS connection from environment...');

      const defaultConfig: AdsConnectionConfig = {
        id: 'default',
        name: 'Default PLC',
        host: process.env.ADS_HOST,
        port: parseInt(process.env.ADS_PORT || '48898'),
        targetIp: process.env.ADS_TARGET_IP,
        targetPort: parseInt(process.env.ADS_TARGET_PORT || '801'),
        sourcePort: parseInt(process.env.ADS_SOURCE_PORT || '32750'),
        enabled: true,
        description: 'Default PLC connection from .env file',
        symbolDiscovery: {
          autoDiscovery: true,
          discoveryInterval: 30000, // Check every 30 seconds
          autoAddVariables: true,
          defaultPollInterval: 1000,
          // Filter: nur Variablen aus GVL (Global Variable List)
          symbolFilter: /^GVL\./
        }
      };

      await adsManager.addConnection(defaultConfig);
    }

    // Initialize REST API v3
    console.log('[Main] Initializing REST API v3...');
    const restApi = new RestApiV3(
      { port: API_PORT, host: API_HOST },
      mqttBroker,
      adsManager
    );

    // Start REST API
    await restApi.start();

    // Start monitoring
    const monitoring = restApi.getMonitoring();
    monitoring.setAdsConnectionManager(adsManager);
    monitoring.setMqttBroker(mqttBroker);

    console.log('='.repeat(60));
    console.log('✓ ADS-MQTT Broker v3.0 is running');
    console.log('='.repeat(60));
    console.log(`MQTT Broker:  mqtt://${MQTT_HOST}:${MQTT_PORT}`);
    console.log(`REST API:     http://${API_HOST}:${API_PORT}`);
    console.log(`Dashboard:    http://${API_HOST}:${API_PORT}/admin-dashboard-v3.html`);
    console.log('='.repeat(60));
    console.log('Features:');
    console.log('  • Multiple ADS connections');
    console.log('  • Automatic symbol discovery');
    console.log('  • OnlineChange detection');
    console.log('  • Historical data persistence');
    console.log('  • Real-time monitoring');
    console.log('  • Audit logging');
    console.log('='.repeat(60));

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[Main] Shutting down gracefully...');
      await adsManager.disconnectAll();
      await mqttBroker.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('[Main] Fatal error during startup:', error);
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (error) => {
  console.error('[Main] Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
  process.exit(1);
});

// Start the application
main();
