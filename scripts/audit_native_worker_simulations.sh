#!/usr/bin/env bash
# Detect remaining native-worker simulation paths using the approved remediation manifest.
# --report is non-destructive and exits 0. --enforce exits non-zero until all prohibited
# paths are removed and intentional simulations satisfy provenance checks.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$root/config/native-worker-simulation-remediation.tsv"
enforce=false

usage() {
  cat <<'USAGE'
Usage: scripts/audit_native_worker_simulations.sh [--report|--enforce]

--report   Print the tracked remediation status and exit zero (default).
--enforce  Exit non-zero while prohibited simulations, mocks, or incomplete feature
           placeholders remain in production worker source.
USAGE
}

while (($#)); do
  case "$1" in
    --report) enforce=false ;;
    --enforce) enforce=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

test -f "$manifest" || { echo "Missing manifest: $manifest" >&2; exit 66; }

failed=0
intentional_failed=0
printf '%-8s %-46s %-34s %s\n' STATUS PATH CLASSIFICATION ACTION
printf '%-8s %-46s %-34s %s\n' ------ ---- -------------- ------

while IFS=$'\t' read -r path line component classification release_action acceptance_evidence; do
  [[ "$path" == "path" ]] && continue
  source="$root/$path"
  if [[ ! -f "$source" ]]; then
    printf '%-8s %-46s %-34s %s\n' MISSING "$path" "$classification" 'source file missing; investigate registration'
    failed=1
    continue
  fi

  case "$classification" in
    implemented_pending_external_acceptance)
      if grep -Eqi 'Return mock|realistic mock|CVE database simulation|Nessus/OpenVAS simulation|rand\.Intn|rand\.Float|Simulates Arkime|BGP_STREAM_URL|NMAP_PATH' "$source"; then
        printf '%-8s %-46s %-34s %s\n' FAIL "$path" "$classification" 'fabricated response/data path remains'
        failed=1
      else
        printf '%-8s %-46s %-34s %s\n' REVIEW "$path" "$classification" 'source replacement complete; real-provider acceptance pending'
        failed=1
      fi
      ;;
    intentional_simulation_feature)
      if grep -Eqi 'simulation(_id| provenance| mode)|what-if|simulat' "$source" \
        && ! grep -Eqi 'enforcement|ledger|trust-provider' "$source"; then
        printf '%-8s %-46s %-34s %s\n' REVIEW "$path" "$classification" 'intentional model; validate output isolation manually'
      else
        printf '%-8s %-46s %-34s %s\n' FAIL "$path" "$classification" 'missing explicit provenance or isolation evidence'
        intentional_failed=1
      fi
      ;;
    fail_closed_incomplete_feature_vector)
      if grep -Fq 'authoritative temporal and text embedding providers are required for production GNN features' "$source" \
        && grep -Fq 'missing_dimensions' "$source" \
        && ! grep -Fq 'placeholder for temporal feature' "$source"; then
        printf '%-8s %-46s %-34s %s\n' REVIEW "$path" "$classification" 'incomplete dimensions are explicitly refused in production; provider implementation and acceptance pending'
        failed=1
      else
        printf '%-8s %-46s %-34s %s\n' FAIL "$path" "$classification" 'fixed or unlabelled feature dimensions remain'
        failed=1
      fi
      ;;
    implemented_model_isolation_pending_external_acceptance)
      if grep -Fq 'simulation_provenance' "$source" \
        && grep -Fq 'enforcement_eligible' "$source" \
        && grep -Fq 'X-NDSEP-Simulation' "$source" \
        && grep -Fq 'DATABASE_URL is required in production' "$source"; then
        printf '%-8s %-46s %-34s %s\n' REVIEW "$path" "$classification" 'model output is labelled and persistence fails closed; downstream isolation acceptance pending'
        failed=1
      else
        printf '%-8s %-46s %-34s %s\n' FAIL "$path" "$classification" 'missing output provenance, enforcement isolation, or production persistence guard'
        failed=1
      fi
      ;;
    stale_simulation_documentation)
      if grep -Eqi 'API simulation|verification.*simulation' "$source"; then
        printf '%-8s %-46s %-34s %s\n' FAIL "$path" "$classification" 'stale simulation claim remains'
        failed=1
      else
        printf '%-8s %-46s %-34s %s\n' PASS "$path" "$classification" 'no stale simulation wording detected'
      fi
      ;;
    *)
      # Tracked line remains present until implementation removes the fabricated path.
      if sed -n "${line},$((line + 20))p" "$source" | grep -Eqi 'mock|simulat|placeholder|hardcoded|random'; then
        printf '%-8s %-46s %-34s %s\n' FAIL "$path" "$classification" 'prohibited response/data simulation remains'
        failed=1
      else
        printf '%-8s %-46s %-34s %s\n' REVIEW "$path" "$classification" 'marker changed; inspect implementation and add tests'
        failed=1
      fi
      ;;
  esac
done < "$manifest"

if "$enforce" && (( failed || intentional_failed )); then
  echo 'NATIVE_WORKER_SIMULATION_GATE=BLOCKED' >&2
  exit 1
fi
if (( failed || intentional_failed )); then
  echo 'NATIVE_WORKER_SIMULATION_GATE=REMEDIATION_REQUIRED'
else
  echo 'NATIVE_WORKER_SIMULATION_GATE=PASS'
fi
