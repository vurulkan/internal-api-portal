# syntax=docker/dockerfile:1

# Base images are pinned by digest; Dependabot proposes updates.
# The build stages run on the build machine's platform and cross-compile, so a
# multi-arch build doesn't emulate npm or the Go compiler.

FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/tailwind.config.js frontend/postcss.config.js ./
COPY frontend/src ./src
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:738d1cf061836894ff6bb8c33881080ac66de8cf0586615012a0c8f592649cfa AS backend-build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server \
 && mkdir -p /out/data

# Distroless: no shell, no package manager, CA certificates and tzdata included.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/vurulkan/internal-api-portal" \
      org.opencontainers.image.title="Internal API Portal" \
      org.opencontainers.image.version="${VERSION}"

# uid 100 / gid 101 is the "portal" user of the images up to 1.2.0, whose entrypoint
# chowned /data to it, so existing volumes stay writable without a chown step.
# /data is created owned by that user so a fresh Docker named volume is writable too.
COPY --from=backend-build --chown=100:101 /out/data /data
COPY --from=backend-build /out/server /app/server
COPY --from=frontend-build /app/dist /app/public

ENV PORT=8080 \
    DATA_PATH=/data/app.db \
    STATIC_DIR=/app/public
USER 100:101
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/app/server", "healthcheck"]
ENTRYPOINT ["/app/server"]
