FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html vite.config.ts tsconfig*.json env.d.ts LICENSE ./
COPY src ./src
COPY server ./server
COPY public ./public
RUN npm run build:self-hosted

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    OCL_HOST=0.0.0.0 \
    OCL_PORT=3000 \
    OCL_ORIGIN=http://localhost:3000 \
    OCL_DATABASE_PATH=/data/opticutlist.sqlite \
    OCL_FRONTEND_PATH=/app/dist-self-hosted
WORKDIR /app

COPY --from=build /app/package.json /app/LICENSE ./
COPY --from=build /app/dist-self-hosted ./dist-self-hosted
COPY --from=build /app/server-dist ./server-dist
# The SSR backend's only external package is Zod; UI dependencies are bundled into assets.
COPY --from=build /app/node_modules/zod ./node_modules/zod
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# Use the internal listener, with the configured external Host to preserve origin protection.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "import http from 'node:http'; const request = http.get({hostname:'127.0.0.1',port:process.env.OCL_PORT,path:'/api/v1/health',headers:{Host:new URL(process.env.OCL_ORIGIN).host}}, response => { response.resume(); if (response.statusCode !== 200) process.exitCode = 1 }); request.setTimeout(4000, () => request.destroy()); request.on('error', () => { process.exitCode = 1 })"]

CMD ["node", "server-dist/main.js"]
