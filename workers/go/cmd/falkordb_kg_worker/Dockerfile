FROM golang:1.22-alpine AS build

WORKDIR /src/workers/go
COPY workers/go/go.mod workers/go/go.sum ./
RUN go mod download
COPY workers/go/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /out/falkordb-kg-worker ./cmd/falkordb_kg_worker

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget \
    && addgroup -S ndsep \
    && adduser -S -G ndsep -h /nonexistent -s /sbin/nologin ndsep
COPY --from=build /out/falkordb-kg-worker /usr/local/bin/falkordb-kg-worker
USER ndsep:ndsep
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/falkordb-kg-worker"]
