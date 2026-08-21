FROM golang:1.22-alpine AS builder
ARG SERVICE
# Existing compose files use CMD; retain that name as a backwards-compatible alias.
ARG CMD
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN service="${SERVICE:-${CMD:-}}"; \
    test -n "$service"; \
    CGO_ENABLED=0 GOOS=linux go build -o /app/service "./cmd/${service}/main.go"

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata && adduser -D -u 1001 appuser
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 8130 8150 8160 8170 8240
USER appuser
CMD ["/app/service"]
