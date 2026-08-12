# Override this only when a network cannot reach Docker Hub, for example:
# --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
ARG NODE_IMAGE=node:22-alpine

# Dependencies are kept in a separate layer so source-only edits do not
# invalidate the npm install cache.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# The runtime image does not need TypeScript, ESLint or Vitest dependencies.
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Run the web process as the unprivileged user included in the Node image.
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/next.config.mjs ./next.config.mjs

USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
