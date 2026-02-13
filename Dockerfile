# CodeFlow – Node + Python for Fly.io
# Base has Node 20; we add Python 3 so the server can run user code.
FROM node:20-bookworm

# Install Python 3 (required for "Run" feature; server spawns python3).
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app (server + public).
COPY . .

# Fly sets PORT; app listens on 0.0.0.0.
EXPOSE 3000

CMD ["node", "server.js"]
