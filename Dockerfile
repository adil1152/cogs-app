# Stage 1: Build environment
FROM node:22-slim AS builder

# Enable pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy the workspace configuration and package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/cogs-tracker/package.json ./artifacts/cogs-tracker/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib/db/package.json ./lib/db/
COPY lib/api-zod/package.json ./lib/api-zod/

# Copy the rest of the application code
COPY . .

# Install all dependencies without scripts, then manually trigger esbuild's postinstall
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm rebuild esbuild

# Build the frontend and backend
ENV PORT=5173
ENV BASE_PATH=/
RUN pnpm run build

# Skip pnpm prune --prod because it deletes workspace dependencies in pnpm v11

# Stage 2: Production runtime environment
FROM node:22-slim AS runner

WORKDIR /app

# Install native tools that might be needed by some libraries at runtime
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy the fully built application and production dependencies from the builder
COPY --from=builder /app /app

# Create an empty .env file so that the --env-file flag in package.json doesn't crash Node
RUN touch .env

# Expose the API port
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

# Set working directory to the api-server so relative paths resolve correctly
WORKDIR /app/artifacts/api-server

# Run the API server directly (bypassing pnpm so it starts instantly without needing corepack)
CMD ["node", "--enable-source-maps", "--env-file=../../.env", "./dist/index.mjs"]
