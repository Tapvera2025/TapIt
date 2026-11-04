FROM node:24-bookworm-slim

# Docker supplies TARGETARCH automatically for multi-platform builds. Tailwind
# Oxide ships platform-specific optional binaries, so install the binary that
# matches the image rather than the host that generated package-lock.json.
ARG TARGETARCH

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/authz/package.json packages/authz/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm ci --include=optional \
  && OXIDE_CPU="$(case "${TARGETARCH}" in amd64) printf '%s' 'x64' ;; arm64) printf '%s' 'arm64' ;; *) printf '%s' "${TARGETARCH}" ;; esac)" \
  && npm install --no-save --package-lock=false --include=optional --os=linux --cpu="${OXIDE_CPU}" --libc=glibc @tailwindcss/oxide \
  && npm cache clean --force \
  && rm -rf /root/.cache/node-gyp

COPY . .
RUN npm run clean && npm run build

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace", "@tapcrm/client", "--", "--host", "0.0.0.0"]
