# Synthetic connector

`@auto-world/synthetic-connector` is a demo/test-only composition over the accepted Connector SDK. Its `./demo` entrypoint is available only with the `auto-world-demo` Node condition and rejects `NODE_ENV=production`.

The fixed `synthetic-search-v1` corpus contains neutral price/mileage evidence only. It is not a production source, legal authorization, durable store, search read model, network sandbox or deployable connector. The harness reuses the SDK's production-excluded test-support store; TASK-0102 owns any `DemoReadPort` implementation.
