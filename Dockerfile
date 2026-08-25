# syntax=docker/dockerfile:1.7

FROM node:22.23.1-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

RUN pnpm db:generate && pnpm build

FROM build AS api

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-numpy \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV API_PORT=3101

EXPOSE 3101

CMD ["node", "apps/api/dist/main.js"]

FROM build AS web

ENV NODE_ENV=production
ENV NEXT_DIST_DIR=.next-build

EXPOSE 3100

CMD ["pnpm", "--filter", "@climbing-crm/web", "start"]
