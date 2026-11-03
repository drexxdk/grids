FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
RUN npm ci --omit=dev --ignore-scripts --workspace @grids/api --workspace @grids/database --workspace @grids/contracts
COPY apps/api/src apps/api/src
COPY packages/contracts packages/contracts
COPY packages/database packages/database
ENV NODE_ENV=production PORT=5841
USER node
EXPOSE 5841
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:5841/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
