//! NDSEP TigerBeetle ledger worker.
//!
//! This Rust target is deliberately disabled. It previously contained an
//! in-memory accounting fallback, which cannot provide the durability,
//! consistency, or audit guarantees required for financial records. Production
//! deployments must use the TigerBeetle-backed implementation at
//! `orchestration/go/cmd/tigerbeetle_ledger` with both
//! `TIGERBEETLE_CLUSTER_ID` and `TIGERBEETLE_ADDRESSES` configured.

fn main() {
    eprintln!(
        "The Rust in-memory TigerBeetle ledger is disabled. Deploy the TigerBeetle-backed Go ledger worker with required cluster configuration."
    );
    std::process::exit(78);
}
