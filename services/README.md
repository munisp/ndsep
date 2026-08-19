# Polyglot Service Boundaries

The Go event gateway, Python compliance API, and Rust policy engine are **not production middleware integrations**. They run only as explicitly labelled development emulators when `IDLR_EMULATOR_MODE=true`. Without that flag, their health status is `unconfigured` and the Go/Python action endpoints fail closed.

They exist to validate HTTP contracts and user-visible unavailable/emulator states while target infrastructure is prepared. They must not be presented as Kafka, Redis, TigerBeetle, Permify, APISIX, lakehouse, regulatory, or payment-system connectivity.
