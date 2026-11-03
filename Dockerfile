# Production image: builds the React app, then serves it from the Express API.
#   docker build -t tatami .
#   docker run --env-file .env -p 4000:4000 tatami
# Note: VITE_* values are baked in at build time, so pass them as build args:
#   docker build --build-arg VITE_LD_CLIENT_SIDE_ID=xxx -t tatami .

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
ARG VITE_LD_CLIENT_SIDE_ID=""
ARG VITE_DEMO_MODE="true"
ENV VITE_LD_CLIENT_SIDE_ID=$VITE_LD_CLIENT_SIDE_ID VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DB_FILE=/data/tatami.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 4000
USER node
CMD ["node", "server/src/index.js"]
