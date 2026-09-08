FROM node:24-bookworm-slim

WORKDIR /app

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

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace", "@tapcrm/client", "--", "--host", "0.0.0.0"]
