# Self-hosted OSIRIS sidecar (Round-13 W6 / P2.10)

NDSEP consumes OSIRIS (https://github.com/simplifaisoul/osiris) for OSINT,
disaster, and maritime feeds. By default it talks to the hosted API at
`https://osirisai.live`. This document describes running OSIRIS as a
**sidecar** inside your own perimeter instead.

## Run the sidecar

```bash
# 1. Generate the shared scanner key (NDSEP <-> OSIRIS auth)
openssl rand -hex 32

# 2. Export it for both sides
export OSIRIS_SCANNER_KEY=<the hex above>

# 3. Start the sidecar (joins the external ndsep-ndsep-net network)
docker compose -f infra/osiris/docker-compose.osiris.yml up -d

# 4. Point NDSEP at the sidecar (.env)
OSIRIS_URL=http://osiris:3000
OSIRIS_SELF_HOSTED=true
# OSIRIS_PORT=3000   # host port mapping, compose-only
```

The compose service (`infra/osiris/docker-compose.osiris.yml`) pulls
`ghcr.io/simplifaisoul/osiris:latest`, passes `SCANNER_URL`/`SCANNER_KEY`
through to the container, healthchecks `:3000/health` every 30s, and runs
with `restart: unless-stopped`. Prefer a non-root container user once the
upstream image ships one — do not paper over upstream with a root override.

## What breaks without OSIRIS (graceful degradation list)

Every NDSEP OSIRIS consumer is fire-and-forget: a down/unreachable OSIRIS
never throws into request paths, never fabricates data, and (where a
verdict exists) fails CLOSED. Specifically:

| Consumer | Without OSIRIS |
| --- | --- |
| Sanctions/conflict/country-risk feeds (`server/osirisClient.ts`) | cached/empty results; enrichment simply absent |
| Hosting-declaration verification (`server/osiris/reconClient.ts`, P0.2) | verdict **'unverified' — never 'compliant'** (fail-closed) |
| Infra posture scans (`server/osiris/...`, P0.3) | fail-closed run row recorded, **no phantom "clean" posture** |
| Disaster availability watch (`server/osiris/disasterClient.ts`, P2.8) | sweep records the feed outage; **no phantom "all clear"** |
| Cable-landing maritime watch (`server/osiris/maritimeClient.ts`, P2.9) | sweep records the outage; no new alerts (existing alerts persist) |

All clients share the same contract: 10s timeout, 15-minute in-memory
cache, `null` on failure, tolerant field narrowing against schema drift.

## Scanner key generation

```bash
openssl rand -hex 32
```

Set the same value as `OSIRIS_SCANNER_KEY` (NDSEP) and `SCANNER_KEY`
(OSIRIS container). The env-example CI gate
(`node scripts/envExampleGen.mjs --check`) always redacts it to
`CHANGE_ME_IN_PRODUCTION`.
