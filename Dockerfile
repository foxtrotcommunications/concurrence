# Concurrence dashboard: Express API + built client in one Cloud Run service.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/tools-gate/package.json packages/tools-gate/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "api/server.ts"]
