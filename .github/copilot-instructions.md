# ADS-MQTT Broker Development Guide

This is a standalone Node.js/TypeScript project for the ADS-MQTT Broker with:
- Aedes MQTT Broker (1883)
- Express REST API (8080)
- Beckhoff ADS Gateway Integration
- Audit Logging System
- Admin Dashboard

## Quick Start

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Start: `npm start`
4. Access: http://localhost:8080/admin-dashboard.html

## Development Commands

- `npm run dev` - Start with ts-node
- `npm run watch` - Watch mode compilation
- `npm run build` - Build TypeScript
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run docker:build` - Build Docker image
- `npm run docker:run` - Run Docker container

## Project Structure

```
src/
├── index.ts              - Main entry point
├── ads-gateway.ts        - ADS variable polling
├── mqtt-broker.ts        - MQTT broker wrapper
├── rest-api.ts           - REST API with audit
└── audit-logger.ts       - Audit logging service

admin-dashboard.html      - Web UI
test-broker.js           - API tests
```

## Configuration

Copy `.env.example` to `.env` and customize:

```
MQTT_PORT=1883
API_PORT=8080
ADS_HOST=localhost
```

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/variables` - List variables
- `POST /api/variables` - Create variable
- `GET /api/audit/logs` - Audit logs
- `GET /api/audit/stats` - Statistics

See README.md for full documentation.
