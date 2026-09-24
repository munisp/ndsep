# APISIX `data-residency` plugin

Gateway-level data-residency enforcement for the NDSEP platform. Supports the
CBN data-localisation mandate (Circular PSS/DIR/PUB/CIR/001/004, 2026-06-15;
compliance deadline **2027-01-01**): payment transaction data generated in
Nigeria must be stored and managed in Nigeria.

The plugin classifies each request's destination against a residency ruleset,
tags the request with a verdict header, emits a JSON residency event
(Kafka or HTTP fallback), and — in `enforce` mode — rejects foreign
destinations with HTTP 403.

## What it does

| Concern | Behaviour |
|---|---|
| Classification | Destination IP matched against `allowed_cidrs` (longest-prefix via `apisix.core.ipmatcher`); hostname matched against `allowed_host_suffixes`. RFC1918/loopback destinations count as domestic when `treat_private_as_domestic` is true. |
| Verdicts | `domestic` — matched the Nigerian allow-list. `foreign` — concrete IP not in the allow-list and not private. `unknown` — hostname that cannot be reduced to any rule (never assumed domestic). |
| Request tagging | Adds `X-Residency-Verdict: <verdict>` and `X-Residency-Reference: <code>` to the proxied request and the response. |
| Event emission | JSON event to Kafka (`lua-resty-kafka`) or, failing that, HTTP POST to `http_fallback_url` (`lua-resty-http`). If no transport works, the event payload is written to the error log — **no silent drops**. |
| Modes | `passive` (default): classify, tag, emit. `enforce`: additionally return `403` with a reference code for `foreign` verdicts. |
| Config scope | Per-route (standard APISIX plugin semantics). |

## Install

1. Copy the plugin into the APISIX plugin directory:

   ```sh
   cp infra/apisix/plugins/data_residency.lua /usr/local/apisix/apisix/plugins/data-residency.lua
   ```

2. Register it in `conf/config.yaml` (custom plugins list):

   ```yaml
   plugins:
     - ...existing plugins...
     - data-residency
   ```

   (On APISIX >= 3.x with a plugin allow-list, also add `data-residency` to
   `plugin_attr`/deployment config as appropriate for your distribution.)

3. Reload APISIX:

   ```sh
   apisix reload
   ```

4. Optional transports (either or both):
   - `lua-resty-kafka` for direct Kafka emission (topic default
     `gateway.residency_verdicts`).
   - `lua-resty-http` for the HTTP fallback endpoint.

## Enable on a route

Passive (observe-only) — recommended first step:

```sh
curl http://apisix-admin:9180/apisix/admin/routes/psp-payments \
  -H 'X-API-KEY: <admin-key>' -X PUT -d '{
    "uri": "/payments/*",
    "plugins": {
      "data-residency": {
        "mode": "passive",
        "allowed_cidrs": ["41.58.0.0/16", "102.88.0.0/13"],
        "allowed_host_suffixes": [".ng", "dc-lagos.example.com"],
        "kafka": {"brokers": [{"host": "kafka", "port": 9092}]},
        "http_fallback_url": "http://ndsep-server:3000/api/sovereignty/gateway-events"
      }
    },
    "upstream": {"type": "roundrobin", "nodes": {"10.0.0.10:8080": 1}}
  }'
```

Enforce (after the allow-list is verified):

```json
"data-residency": { "mode": "enforce", "allowed_cidrs": ["..."] }
```

Enforce mode **refuses to start with an empty ruleset** (`check_schema`
fails) — an empty allow-list would 403 every request.

## Keeping the ruleset in sync

`allowed_cidrs` is config-time data. The authoritative, admin-editable
reference lives in the `asn_geo_reference` table (migration 0096, surfaced
via `dataSovereignty.listAsnGeoReference`). Export it in CI and render it
into the route config; the plugin deliberately does **not** connect to
Postgres at runtime.

## Honest limits

- **No TLS payload inspection.** Classification uses SNI/Host header and the
  upstream node address only. Encrypted payload contents are never examined.
- **IP/SNI metadata classification.** CDN-fronted foreign services behind
  Nigerian-fronting IPs (or vice versa) can be misclassified; that is why
  `unknown` exists and why `enforce` should only be enabled after the
  allow-list has been validated in `passive` mode.
- **Hostname destinations** without a resolvable/allow-listed IP are
  `unknown`, not `domestic`. Extend `allowed_host_suffixes` explicitly.
- **Reference data churn.** Cloud and ISP CIDRs change; seed rows in
  migration 0096 are marked `seed-reference-verify` and must be verified
  against AFRINIC WHOIS and provider ip-ranges feeds before enforcement
  reliance.
- The plugin observes gateway traffic only. The full enforcement picture is
  the egress monitor worker (`workers/python/egress_monitor_worker.py`)
  consuming `netflow.egress` flow records.
