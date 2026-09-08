FROM node:24-bookworm-slim

WORKDIR /app

# argon2 may compile during install when a prebuilt binary is unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/authz/package.json packages/authz/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm ci \
  && npm cache clean --force \
  && rm -rf /root/.cache/node-gyp

COPY . .
RUN npm run clean && npm run build

EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "@tapcrm/server"]
