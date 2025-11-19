import * as dotenv from 'dotenv';
import { AdsGateway } from './ads-gateway';
import { MqttBroker } from './mqtt-broker';
import { RestApiV2 } from './rest-api-v2';

dotenv.config();

async function main() {
  const config = {
    mqtt: {
      port: parseInt(process.env.MQTT_PORT || '1883'),
      host: process.env.MQTT_HOST || '0.0.0.0',
    },
    api: {
      port: parseInt(process.env.API_PORT || '8080'),
      host: process.env.API_HOST || '0.0.0.0',
    },
    ads: {
      host: process.env.ADS_HOST || 'localhost',
      port: parseInt(process.env.ADS_PORT || '48898'),
      targetIp: process.env.ADS_TARGET_IP || '127.0.0.1',
      targetPort: parseInt(process.env.ADS_TARGET_PORT || '801'),
      sourcePort: parseInt(process.env.ADS_SOURCE_PORT || '32750'),
    },
  };

  try {
    console.log('🚀 Starting ADS-MQTT Broker v2...');
    console.log('Config:', JSON.stringify(config, null, 2));

    // Initialize MQTT Broker
    console.log('[1/4] Initializing MQTT Broker...');
    const mqttBroker = new MqttBroker(config.mqtt);
    await mqttBroker.start();

    // Initialize ADS Gateway
    console.log('[2/4] Initializing ADS Gateway...');
    const adsGateway = new AdsGateway(
      config.ads.host,
      config.ads.port,
      config.ads.targetIp,
      config.ads.targetPort,
      config.ads.sourcePort
    );

    // Connect ADS Gateway
    await adsGateway.connect();

    // Setup event handlers for variable changes
    adsGateway.on('variable-changed', (variable: any) => {
      console.log(`[Event] Variable changed: ${variable.name} = ${variable.value}`);
      // Publish to MQTT
      mqttBroker.publish(
        variable.mqttTopic,
        JSON.stringify({
          value: variable.value,
          timestamp: variable.timestamp,
        }),
        { retain: true }
      );
    });

    adsGateway.on('variable-error', (event: any) => {
      console.error(`[Event] Variable error:`, event);
      // Publish error to MQTT
      mqttBroker.publish(
        `ads/${event.variableId}/error`,
        JSON.stringify({
          error: event.error,
          timestamp: event.timestamp,
        })
      );
    });

    // Initialize REST API v2 with Persistence and Monitoring
    console.log('[3/4] Initializing REST API v2...');
    const restApi = new RestApiV2(config.api, mqttBroker, adsGateway);
    restApi.start();

    console.log('[4/4] All systems ready!');
    console.log('\n✅ ADS-MQTT Broker v2 is running');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📡 MQTT Broker:     mqtt://${config.mqtt.host}:${config.mqtt.port}`);
    console.log(`🌐 REST API:        http://${config.api.host}:${config.api.port}`);
    console.log(`📊 Dashboard v1:    http://${config.api.host}:${config.api.port}/admin-dashboard.html`);
    console.log(`🚀 Dashboard v2:    http://${config.api.host}:${config.api.port}/admin-dashboard-v2.html`);
    console.log(`📚 API Docs:        http://${config.api.host}:${config.api.port}/api/docs`);
    console.log(`🔧 ADS Gateway:     ${config.ads.host}:${config.ads.port}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 Features:');
    console.log('  ✓ SQLite Persistenz für Variablen-Historie');
    console.log('  ✓ System-Monitoring (CPU, RAM, MQTT, API)');
    console.log('  ✓ Echtzeit-Charts und Graphen');
    console.log('  ✓ Erweiterte Statistiken');
    console.log('  ✓ Vollständiges Audit-Logging');
    console.log('\n📌 Drücken Sie Ctrl+C zum Beenden\n');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n⏹️  Shutting down gracefully...');
      restApi.stop();
      await adsGateway.disconnect();
      await mqttBroker.stop();
      console.log('✅ Shutdown complete');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
