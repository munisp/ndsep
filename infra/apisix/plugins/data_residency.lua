--
-- NDSEP data-residency — APISIX plugin
--
-- Regulatory driver: CBN Circular PSS/DIR/PUB/CIR/001/004 (2026-06-15) —
-- payment transaction data generated in Nigeria must be stored and managed
-- in Nigeria by 2027-01-01.
--
-- What this plugin does, per route:
--   1. Classifies the request destination (upstream host / Host header)
--      against a residency ruleset: an allow-list of Nigerian CIDRs and
--      Nigerian host suffixes supplied in the plugin config (synced from the
--      asn_geo_reference table — see drizzle/migrations/0096).
--   2. Tags the proxied request with an X-Residency-Verdict header
--      (domestic | foreign | unknown) plus an X-Residency-Reference code.
--   3. Emits a JSON residency event to Kafka (lua-resty-kafka) or, if Kafka
--      is not configured/available, to an HTTP fallback endpoint
--      (lua-resty-http). If NEITHER is available it logs at ERROR level —
--      no silent drops.
--   4. Modes:
--        passive  — classify + tag + emit only (default)
--        enforce  — additionally reject foreign destinations with
--                   HTTP 403 and a reference code.
--
-- HONEST LIMITS (see data_residency.README.md):
--   * Classification is IP-CIDR / host-suffix based only (SNI / Host header
--     and upstream node address). There is NO TLS payload inspection.
--   * Hostnames that cannot be reduced to a configured rule are "unknown"
--     (never silently treated as domestic).
--   * The CIDR allow-list is config-time data; it does not hot-reload from
--     Postgres. Keep it in sync with asn_geo_reference via CI.
--

local core = require("apisix.core")
local plugin_name = "data-residency"

local lrucache = core.lrucache.new({
    type = "plugin",
})

local schema = {
    type = "object",
    properties = {
        mode = {
            type = "string",
            enum = { "passive", "enforce" },
            default = "passive",
        },
        allowed_cidrs = {
            type = "array",
            items = { type = "string" },
            minItems = 0,
            default = {},
            description = "Nigerian IP ranges (CIDR). Synced from asn_geo_reference.",
        },
        allowed_host_suffixes = {
            type = "array",
            items = { type = "string" },
            minItems = 0,
            default = {},
            description = "Host suffixes treated as domestic, e.g. '.ng', 'dc-lagos.example.com'.",
        },
        treat_private_as_domestic = {
            type = "boolean",
            default = true,
            description = "RFC1918/loopback/link-local destinations count as domestic.",
        },
        kafka = {
            type = "object",
            properties = {
                brokers = {
                    type = "array",
                    minItems = 1,
                    items = {
                        type = "object",
                        properties = {
                            host = { type = "string" },
                            port = { type = "integer", minimum = 1, maximum = 65535 },
                        },
                        required = { "host", "port" },
                    },
                },
                topic = { type = "string", default = "gateway.residency_verdicts" },
            },
            required = { "brokers" },
            description = "Optional. If absent/unreachable, the HTTP fallback is used.",
        },
        http_fallback_url = {
            type = "string",
            description = "Optional HTTP(S) endpoint receiving the JSON event when Kafka is unavailable.",
        },
        verdict_header = { type = "string", default = "X-Residency-Verdict" },
        reference_code_prefix = { type = "string", default = "NDSEP-RES" },
    },
}

local _M = {
    version = 0.1,
    priority = 3010,
    name = plugin_name,
    schema = schema,
}


function _M.check_schema(conf)
    local ok, err = core.schema.check(schema, conf)
    if not ok then
        return false, err
    end
    if conf.mode == "enforce" and #conf.allowed_cidrs == 0 and #conf.allowed_host_suffixes == 0 then
        return false, "enforce mode requires at least one allowed_cidrs or allowed_host_suffixes entry " ..
                      "(refusing to enforce with an empty ruleset, which would 403 everything)"
    end
    -- Validate CIDRs with the same matcher used at runtime: a config that
    -- ipmatcher cannot compile must be rejected at schema-check time, not
    -- silently degrade classification later.
    if #conf.allowed_cidrs > 0 then
        local pok, ipmatcher = pcall(require, "apisix.core.ipmatcher")
        if not pok then
            return false, "apisix.core.ipmatcher unavailable; cannot validate allowed_cidrs"
        end
        local matcher, cerr = ipmatcher.new(conf.allowed_cidrs)
        if not matcher then
            return false, "invalid CIDR in allowed_cidrs: " .. tostring(cerr)
        end
    end
    return true
end


local function get_matcher(conf)
    -- Cache the compiled ipmatcher per route config.
    local key = table.concat(conf.allowed_cidrs, ",")
    local matcher, err = lrucache(key, nil, function()
        if #conf.allowed_cidrs == 0 then
            return nil
        end
        local ipmatcher = require("apisix.core.ipmatcher")
        local m, cerr = ipmatcher.new(conf.allowed_cidrs)
        if not m then
            core.log.error(plugin_name, ": failed to compile allowed_cidrs: ", cerr)
            return nil
        end
        return m
    end)
    if err then
        core.log.error(plugin_name, ": ipmatcher cache error: ", err)
        return nil
    end
    return matcher
end


local function is_private_ip(ip)
    -- ipmatcher is built from RFC1918 + loopback + link-local ranges.
    local private_matcher = lrucache("private-ranges", nil, function()
        local ipmatcher = require("apisix.core.ipmatcher")
        local m = ipmatcher.new({
            "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
            "127.0.0.0/8", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10",
        })
        return m
    end)
    return private_matcher and private_matcher:match(ip) or false
end


local function host_suffix_match(host, suffixes)
    host = string.lower(host)
    for _, suffix in ipairs(suffixes) do
        local s = string.lower(suffix)
        if host == s then
            return true
        end
        if #host > #s and string.sub(host, -#s) == s
           and string.sub(host, -#s - 1, -#s - 1) == "." then
            return true
        end
        -- allow suffixes written with a leading dot (".ng")
        if string.sub(s, 1, 1) == "." and #host >= #s
           and string.sub(host, -#s) == s then
            return true
        end
    end
    return false
end


--- Classify a concrete destination IP. Returns "domestic" | "foreign".
local function classify_ip(conf, ip)
    if conf.treat_private_as_domestic and is_private_ip(ip) then
        return "domestic"
    end
    local matcher = get_matcher(conf)
    if matcher and matcher:match(ip) then
        return "domestic"
    end
    -- A concrete IP that is NOT in the Nigerian allow-list and not
    -- private: for residency purposes that is foreign.
    return "foreign"
end


--- Strip an optional :port suffix (and upstream_addr comma lists) to a bare IP.
local function bare_ip(addr)
    if not addr then
        return nil
    end
    -- upstream_addr may be a comma-separated list; the LAST entry is the
    -- final upstream actually contacted.
    local last = addr:match("([^,%s]+)%s*$") or addr
    local host = last:match("^%[(.-)%]") or last:match("^(.-):%d+$") or last
    if host:match("^%d+%.%d+%.%d+%.%d+$") or host:find(":") then
        return host
    end
    return nil
end


--- Classify the request destination. Returns "domestic" | "foreign" | "unknown".
--- `ip` is a concrete destination IP when one is authoritatively known
--- (balancer phase); NEVER ctx.var.server_addr (that is the gateway's OWN
--- address — classifying it mislabels every route).
local function classify(conf, ctx, ip)
    local host = ctx.var.host or ""

    if host ~= "" and host_suffix_match(host, conf.allowed_host_suffixes) then
        return "domestic"
    end

    -- Prefer the balancer-selected upstream IP; then a literal-IP Host.
    local candidate = ip
    if not candidate and host:match("^%d+%.%d+%.%d+%.%d+$") then
        candidate = host
    end
    if candidate then
        return classify_ip(conf, candidate)
    end

    -- Hostname we cannot reduce to a rule: UNKNOWN, never assumed domestic.
    return "unknown"
end


local function build_event(conf, ctx, verdict, action)
    return {
        ts = os.date("!%Y-%m-%dT%H:%M:%SZ"),
        plugin = plugin_name,
        route_id = ctx.route_id,
        service_id = ctx.service_id,
        remote_addr = ctx.var.remote_addr,
        host = ctx.var.host,
        uri = ctx.var.uri,
        method = ctx.var.request_method,
        verdict = verdict,
        mode = conf.mode,
        action = action,
        reference_code = ctx.residency_reference_code,
    }
end


-- Shared Kafka producer per broker-list config: a producer per request leaks
-- connections; cache it (module-level via lrucache) and flush after sends.
local function get_kafka_producer(kafka_conf)
    local key_parts = {}
    for _, b in ipairs(kafka_conf.brokers) do
        core.table.insert(key_parts, b.host .. ":" .. tostring(b.port))
    end
    local key = table.concat(key_parts, ",")
    return lrucache("kafka-producer:" .. key, nil, function()
        local ok, kafka = pcall(require, "resty.kafka.producer")
        if not ok then
            core.log.warn(plugin_name, ": lua-resty-kafka not installed — using HTTP fallback")
            return nil
        end
        local broker_list = {}
        for _, b in ipairs(kafka_conf.brokers) do
            core.table.insert(broker_list, { host = b.host, port = b.port })
        end
        return kafka:new(broker_list, { producer_type = "async" })
    end)
end


local function emit_event(conf, event)
    local payload = core.json.encode(event)

    -- Preferred path: Kafka via lua-resty-kafka (optional dependency).
    if conf.kafka then
        local producer = get_kafka_producer(conf.kafka)
        if producer then
            local send_ok, send_err = producer:send(conf.kafka.topic, nil, payload)
            if send_ok then
                -- async producer buffers; flush so the event actually leaves.
                local flush_ok, flush_err = producer:flush()
                if flush_ok then
                    return
                end
                core.log.error(plugin_name, ": Kafka flush failed (", flush_err,
                               ") — falling back to HTTP")
            else
                core.log.error(plugin_name, ": Kafka send failed (", send_err,
                               ") — falling back to HTTP")
            end
        end
    end

    -- Fallback path: HTTP POST via lua-resty-http (optional dependency).
    -- Only a 2xx response counts as delivered.
    if conf.http_fallback_url then
        local ok, http = pcall(require, "resty.http")
        if ok then
            local httpc = http.new()
            httpc:set_timeout(3000)
            local res, req_err = httpc:request_uri(conf.http_fallback_url, {
                method = "POST",
                body = payload,
                headers = { ["Content-Type"] = "application/json" },
            })
            if res and res.status >= 200 and res.status < 300 then
                return
            end
            core.log.error(plugin_name, ": HTTP fallback emit failed: ",
                           req_err or (res and res.status))
        else
            core.log.error(plugin_name, ": lua-resty-http not installed — cannot emit event")
        end
    end

    -- No transport succeeded: loud failure, never a silent drop.
    core.log.error(plugin_name, ": residency event DROPPED — no working transport. Event: ", payload)
end


function _M.access(conf, ctx)
    -- Access phase: no balancer IP exists yet. Host-suffix rules and
    -- literal-IP hosts classify here; anything unresolved stays "unknown"
    -- and is re-classified in the log phase with the balancer IP.
    local verdict = classify(conf, ctx, nil)
    ctx.residency_verdict = verdict
    ctx.residency_reference_code = conf.reference_code_prefix .. "-" ..
                                   string.sub(ngx.md5(ctx.var.request_id or
                                      (tostring(ngx.now()) .. (ctx.var.host or ""))), 1, 10)

    -- Tag the proxied request so upstreams and downstream logs see the verdict.
    core.request.set_header(ctx, conf.verdict_header, verdict)
    core.request.set_header(ctx, "X-Residency-Reference", ctx.residency_reference_code)

    if conf.mode == "enforce" and verdict == "foreign" then
        ctx.residency_action = "blocked"
        core.log.warn(plugin_name, ": BLOCKED foreign destination host=",
                      ctx.var.host, " ref=", ctx.residency_reference_code)
        return 403, core.json.encode({
            error = "data_residency_violation",
            message = "Destination is outside the Nigerian data-residency allow-list " ..
                      "(CBN Circular PSS/DIR/PUB/CIR/001/004).",
            verdict = verdict,
            reference_code = ctx.residency_reference_code,
        })
    end
    ctx.residency_action = "passed"
end


function _M.balancer(conf, ctx)
    -- The balancer phase is the earliest point where the concrete upstream
    -- IP is known; stash it for the log-phase classification.
    if ctx.balancer_ip then
        ctx.residency_balancer_ip = ctx.balancer_ip
    end
end


function _M.header_filter(conf, ctx)
    if ctx.residency_verdict then
        core.response.set_header(conf.verdict_header, ctx.residency_verdict)
        core.response.set_header("X-Residency-Reference", ctx.residency_reference_code)
    end
end


function _M.log(conf, ctx)
    if not ctx.residency_verdict then
        return
    end
    -- Final classification: resolve an access-phase "unknown" using the
    -- balancer-selected upstream IP (ctx.balancer_ip captured in the balancer
    -- phase, falling back to ctx.var.upstream_addr). No IP -> stays "unknown".
    local verdict = ctx.residency_verdict
    if verdict == "unknown" then
        local ip = ctx.residency_balancer_ip or bare_ip(ctx.var.upstream_addr)
        if ip then
            verdict = classify_ip(conf, ip)
            ctx.residency_verdict = verdict
        end
    end
    local event = build_event(conf, ctx, verdict,
                              ctx.residency_action or "passed")
    event.upstream_ip = ctx.residency_balancer_ip or bare_ip(ctx.var.upstream_addr)
    emit_event(conf, event)
end


return _M
