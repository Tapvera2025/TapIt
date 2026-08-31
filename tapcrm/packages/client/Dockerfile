FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./

COPY packages/contracts/package.json ./packages/contracts/
COPY packages/authz/package.json ./packages/authz/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm ci

COPY . .

RUN npm run build --workspace @tapcrm/contracts
RUN npm run build --workspace @tapcrm/authz

WORKDIR /app/packages/client

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
