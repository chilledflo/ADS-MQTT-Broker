FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm ci --save-dev

COPY . .
RUN npm run build

FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/admin-dashboard.html ./admin-dashboard.html
COPY .env.example .env

EXPOSE 1883 8080

CMD ["node", "dist/index.js"]
