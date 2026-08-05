FROM node:22-bookworm-slim
WORKDIR /app/admin
ENV NODE_ENV=production
COPY admin/package*.json ./
RUN npm ci --omit=dev
COPY admin/server.js ./server.js
COPY admin/public ./public
RUN chown -R node:node /app
USER node
EXPOSE 4300
CMD ["node", "server.js"]
