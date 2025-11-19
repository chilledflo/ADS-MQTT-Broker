#!/usr/bin/env node

/**
 * Test script for ADS-MQTT Broker with Audit Logging
 */

const http = require('http');

function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'test-script',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(responseData)
          });
        } catch {
          resolve({
            status: res.statusCode,
            data: responseData
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting ADS-MQTT Broker Tests\n');

  try {
    // Test 1: Health Check
    console.log('✓ Test 1: Health Check');
    const health = await makeRequest('GET', '/api/health');
    console.log(`  Status: ${health.status}`);
    console.log(`  Clients: ${health.data.clients}`);
    console.log(`  Variables: ${health.data.variables}`);
    console.log(`  API Port: ${health.data.apiPort}\n`);

    // Test 2: Create Variable
    console.log('✓ Test 2: Create Variable');
    const createVar = await makeRequest('POST', '/api/variables', {
      name: 'Motor_Speed',
      path: 'GVL.Motor.Speed',
      type: 'REAL',
      pollInterval: 500
    });
    console.log(`  Status: ${createVar.status}`);
    const varId = createVar.data.id;
    console.log(`  Variable ID: ${varId}`);
    console.log(`  Name: ${createVar.data.name}`);
    if (createVar.data.registeredBy) {
      console.log(`  Registered By: ${createVar.data.registeredBy.userId} from ${createVar.data.registeredBy.userIp}`);
    } else {
      console.log(`  Note: Registration info not available in this version`);
    }

    // Test 3: List Variables
    console.log('✓ Test 3: List Variables');
    const listVars = await makeRequest('GET', '/api/variables');
    console.log(`  Status: ${listVars.status}`);
    console.log(`  Count: ${listVars.data.length}`);
    console.log(`  First Variable: ${listVars.data[0]?.name}\n`);

    // Test 4: Get Variable Details
    console.log('✓ Test 4: Get Variable Details');
    const getVar = await makeRequest('GET', `/api/variables/${varId}`);
    console.log(`  Status: ${getVar.status}`);
    console.log(`  Variable: ${getVar.data.variable.name}`);
    console.log(`  Type: ${getVar.data.variable.type}`);
    console.log(`  History entries: ${getVar.data.history.length}\n`);

    // Test 5: Update Variable Value
    console.log('✓ Test 5: Update Variable Value');
    const updateVar = await makeRequest('PUT', `/api/variables/${varId}`, {
      value: 23.5
    });
    console.log(`  Status: ${updateVar.status}`);
    console.log(`  New Value: ${updateVar.data.value}\n`);

    // Test 6: Get Audit Logs
    console.log('✓ Test 6: Get Audit Logs');
    const auditLogs = await makeRequest('GET', '/api/audit/logs');
    console.log(`  Status: ${auditLogs.status}`);
    console.log(`  Log entries: ${auditLogs.data.length}`);
    if (auditLogs.data.length > 0) {
      console.log(`  Latest action: ${auditLogs.data[0].action}`);
      console.log(`  Details: ${auditLogs.data[0].details}\n`);
    }

    // Test 7: Get Variable History
    console.log('✓ Test 7: Get Variable History');
    const varHistory = await makeRequest('GET', `/api/audit/logs/variable/${varId}`);
    console.log(`  Status: ${varHistory.status}`);
    console.log(`  History entries: ${varHistory.data.length}`);
    varHistory.data.forEach((entry, idx) => {
      console.log(`  [${idx}] ${entry.action} - ${entry.details}`);
    });
    console.log();

    // Test 8: Get Audit Statistics
    console.log('✓ Test 8: Get Audit Statistics');
    const stats = await makeRequest('GET', '/api/audit/stats');
    console.log(`  Status: ${stats.status}`);
    console.log(`  Total Logs: ${stats.data.totalLogs}`);
    console.log(`  Actions: ${JSON.stringify(stats.data.actionStats)}\n`);

    // Test 9: Create another variable for filtering
    console.log('✓ Test 9: Create Second Variable');
    const createVar2 = await makeRequest('POST', '/api/variables', {
      name: 'Sensor_Temp',
      path: 'GVL.Sensor.Temperature',
      type: 'REAL',
      pollInterval: 1000
    });
    console.log(`  Status: ${createVar2.status}`);
    console.log(`  Variable: ${createVar2.data.name}\n`);

    // Test 10: Delete Variable
    console.log('✓ Test 10: Delete Variable');
    const deleteVar = await makeRequest('DELETE', `/api/variables/${varId}`);
    console.log(`  Status: ${deleteVar.status}`);
    console.log(`  Result: ${deleteVar.data.message}\n`);

    // Final Summary
    console.log('✅ All tests completed successfully!\n');

    const finalLogs = await makeRequest('GET', '/api/audit/logs');
    console.log(`📊 Final Audit Log Summary:`);
    console.log(`  Total entries: ${finalLogs.data.length}`);
    console.log(`  Total variables: ${(await makeRequest('GET', '/api/variables')).data.length}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests
runTests().then(() => {
  console.log('\n✨ Test suite completed!');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
