FROM node:20-bookworm-slim

WORKDIR /app

# Native build tooling is required for dependencies like @roamhq/wrtc.
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  make \
  g++ \
  pkg-config \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "-r", "./preload.cjs", "server.js"]
