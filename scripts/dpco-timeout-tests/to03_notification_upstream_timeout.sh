#!/usr/bin/env bash
# TO-03: Upstream accepts a TCP connection but delays its HTTP response beyond five seconds.
# The API must raise an explicit unavailable error, not synthesize a notification result.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"
: "${DPCO_TEST_TENANT_ID:?set DPCO_TEST_TENANT_ID}"

case_name="TO-03"
key="$(new_uuid)"
response_file="$RESULT_DIR/${case_name}-${key}.json"
delay_port="${DPCO_TEST_DELAY_PORT:-18340}"
delay_seconds="${DPCO_TEST_DELAY_SECONDS:-7}"
received_file="$RESULT_DIR/${case_name}-${key}.upstream-received"

python3 - "$delay_port" "$delay_seconds" "$received_file" <<'PY' &
import socket, sys, time
port, delay, received_path = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("127.0.0.1", port))
sock.listen(1)
with open(received_path + ".ready", "w", encoding="utf-8") as out:
    out.write("listening\n")
conn, _ = sock.accept()
with open(received_path, "w", encoding="utf-8") as out:
    out.write("accepted\n")
# Read enough to prove the API sent request bytes, then delay past its configured timeout.
conn.settimeout(1)
try:
    conn.recv(65536)
except OSError:
    pass
time.sleep(delay)
try:
    conn.sendall(b"HTTP/1.1 202 Accepted\r\nContent-Type: application/json\r\nContent-Length: 21\r\n\r\n{\"status\":\"accepted\"}")
except OSError:
    pass
conn.close()
sock.close()
PY
delay_pid=$!
trap 'kill "$delay_pid" 2>/dev/null || true' EXIT

# Wait for the fault server to bind before restarting the API toward it.
for _ in $(seq 1 50); do
  test -f "${received_file}.ready" && break
  sleep 0.05
done
test -f "${received_file}.ready" || { echo "controlled upstream did not bind" >&2; exit 1; }

restart_api_with_notification_url "http://127.0.0.1:${delay_port}"
trpc_send_notification "dpco-licence-expiry-30d" "entity-${key}" "$key" "$response_file"
assert_http_error "$response_file" "DPCO notification service is unavailable"
assert_zero_outbox_rows "$DPCO_TEST_TENANT_ID" "$key"
test -f "$received_file" || { echo "controlled upstream did not receive a connection" >&2; exit 1; }
write_summary "$case_name" "$response_file"
printf 'upstream_connection_accepted=true\n' >>"${response_file}.summary"

echo "${case_name} PASS: delayed upstream timed out fail-closed; evidence=${response_file}.summary"
