FROM node:22-bookworm-slim AS web-build
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci
COPY web/index.html web/tsconfig.json ./
COPY web/public ./public
COPY web/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS meet-build
WORKDIR /build/meet
COPY meet/package*.json ./
RUN npm ci
COPY meet/index.html meet/tsconfig.json ./
COPY meet/public ./public
COPY meet/src ./src
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=web-build /build/web/dist /srv/web
COPY --from=meet-build /build/meet/dist /srv/meet
COPY docker/nginx/entrypoint.sh /docker-entrypoint-meetvap.sh
RUN chmod 755 /docker-entrypoint-meetvap.sh
EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint-meetvap.sh"]
