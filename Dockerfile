# Build stage
FROM node:22-alpine AS builder

# Install build tools for native modules (argon2)
RUN apk add --no-cache python3 make g++ build-base

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (will compile argon2 here)
RUN npm ci

# Copy source and config
COPY tsconfig.json ./
COPY src ./src
COPY bin ./bin

# Build the project
RUN npm run build

# Runtime stage
FROM node:22-alpine AS runtime

# Build version argument passed from CI
ARG BUILD_VERSION=unknown
ENV BUILD_VERSION=${BUILD_VERSION}

# Standard OCI labels
LABEL org.opencontainers.image.title="GigaFlair SIP2 Bridge" \
    org.opencontainers.image.description="Enterprise SIP2-to-JSON Bridge for Library Automation" \
    org.opencontainers.image.vendor="GigaFlair" \
    org.opencontainers.image.source="https://github.com/GigaFlair/SIP2-Bridge" \
    org.opencontainers.image.licenses="MIT" \
    service="sip2-json"

# Set production environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100

WORKDIR /app

# Copy built assets and production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Copy static assets
COPY public ./public

# Setup data directory
RUN mkdir -p data && chown node:node data

# Run as non-root user
USER node

EXPOSE 3100

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

# Start the bridge
CMD ["node", "dist/bin/start.js"]
