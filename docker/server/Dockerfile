FROM node:22-bookworm-slim AS deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package*.json ./
COPY server/tsconfig.json server/prisma.config.ts ./
COPY server/prisma ./prisma
COPY server/src ./src
RUN DATABASE_URL="postgresql://meetvap:meetvap@postgres:5432/meetvap?schema=public" npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
ENV UPLOAD_DIR=/uploads
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=build /app/server/package*.json ./
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/server/node_modules/.prisma ./node_modules/.prisma
RUN mkdir -p /uploads && chown -R node:node /app /uploads
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
