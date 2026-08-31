FROM node:24-alpine

WORKDIR /app

# ------------------------------------------------------------
# Root workspace manifests
# ------------------------------------------------------------

COPY package.json package-lock.json ./

# ------------------------------------------------------------
# Workspace package manifests
# ------------------------------------------------------------

COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/authz/package.json ./packages/authz/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/client/package.json ./packages/client/package.json

# ------------------------------------------------------------
# Install dependencies inside Linux Docker
# ------------------------------------------------------------

RUN npm ci

# ------------------------------------------------------------
# Copy source code.
#
# IMPORTANT:
# node_modules is excluded by .dockerignore.
# ------------------------------------------------------------

COPY . .

# ------------------------------------------------------------
# Build workspace dependencies
# ------------------------------------------------------------

RUN npm run build --workspace=@tapcrm/contracts

RUN npm run build --workspace=@tapcrm/authz

# ------------------------------------------------------------
# Build server too.
# This catches import/dependency problems during Docker build.
# ------------------------------------------------------------

RUN npm run build --workspace=@tapcrm/server

# ------------------------------------------------------------
# Runtime
# ------------------------------------------------------------

WORKDIR /app/packages/server

EXPOSE 4000

CMD ["npm", "run", "start:docker"]
