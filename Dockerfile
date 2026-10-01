FROM node:24-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine AS production

WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=3000
ENV GUILD_DATA_DIR=/data

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/seed ./seed
COPY backend/scripts ./scripts
COPY backend/config ./config
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "src/index.js"]
