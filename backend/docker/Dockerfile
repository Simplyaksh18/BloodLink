FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate --schema src/prisma/schema.prisma
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache dumb-init openssl

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY src/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/src/prisma/migrations ./prisma/migrations

# Copy prisma CLI from builder so the entrypoint can run db push
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN mkdir -p /app/logs /tmp/bloodlink-uploads \
    && chown -R nodejs:nodejs /app/logs /tmp/bloodlink-uploads /app/node_modules/@prisma /app/node_modules/prisma /app/node_modules/.bin/prisma
USER nodejs

EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "entrypoint.sh"]
