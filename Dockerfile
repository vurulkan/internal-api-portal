# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/tailwind.config.js frontend/postcss.config.js ./
COPY frontend/src ./src
RUN npm run build

FROM golang:1.27-alpine AS backend-build
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
ARG VERSION=dev
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /app/server ./cmd/server

FROM alpine:3.22 AS runtime
RUN addgroup -S portal && adduser -S portal -G portal && apk add --no-cache ca-certificates tzdata su-exec
WORKDIR /app
COPY --from=backend-build /app/server /app/server
COPY --from=frontend-build /app/dist /app/public
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
