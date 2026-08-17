#!/usr/bin/env bash
set -euo pipefail
environment="$1"; cohort="$2"
case "$environment" in staging|production) ;; *) exit 64;; esac
case "$cohort" in 0|shadow|1|10|25|50|100) ;; *) exit 64;; esac
echo "Deploy replay service to ${environment}; feature cohort=${cohort}"
# CI injects cloud workload identity. Deploy only immutable image digests and set
# replay feature flags; never print secret values or KMS identifiers.
