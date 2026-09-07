import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const serviceImages = { postgres: "postgres", opensearch: "opensearch", redis: "redis", "object-store": "seaweedfs" };
const digest = /^sha256:[a-f0-9]{64}$/u;

test("data infrastructure records every immutable service and tool image with its platform", () => {
  const pins = read("infra/images.json");
  assert.equal(pins.schemaVersion, 1);
  assert.deepEqual(Object.keys(pins.images).sort(), ["awsCli", "opensearch", "postgres", "redis", "seaweedfs", "trivy"]);
  for (const image of Object.values(pins.images)) {
    assert.match(image.manifestDigest, digest);
    assert.match(image.platform.digest, digest);
    assert.equal(image.platform.os, "linux");
    assert.equal(image.platform.architecture, "amd64");
    assert.equal(image.platform.variant, null);
    assert.ok(image.version.length > 0 && image.version !== "latest");
    assert.match(image.repository, /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u);
  }
});

test("Compose uses only the four pinned, unprivileged foundation services", () => {
  const compose = read("infra/compose.json");
  const pins = read("infra/images.json").images;
  assert.deepEqual(Object.keys(compose.services).sort(), Object.keys(serviceImages).sort());
  for (const [name, imageName] of Object.entries(serviceImages)) {
    const service = compose.services[name];
    assert.equal(service.image, `${pins[imageName].repository}@${pins[imageName].manifestDigest}`);
    assert.equal(service.platform, "linux/amd64");
    assert.equal(service.container_name, undefined);
    assert.equal(service.privileged, undefined);
    assert.equal(service.network_mode, undefined);
    assert.equal(service.devices, undefined);
    assert.equal(service.restart, "unless-stopped");
    assert.ok(service.healthcheck.test.length > 1);
    assert.ok(service.healthcheck.timeout);
    assert.ok(service.healthcheck.retries > 0);
    assert.ok(service.cpus > 0 && service.cpus <= 2);
    assert.ok(service.mem_limit);
    assert.ok(service.pids_limit > 0 && service.pids_limit <= 2048);
    assert.equal(service.logging.driver, "json-file");
    assert.ok(service.logging.options["max-size"]);
    assert.ok(service.logging.options["max-file"]);
    assert.equal(service.labels["io.auto-world.owner"], "${AW_OWNER_TOKEN:?}");
    for (const port of service.ports) assert.equal(port.host_ip, "127.0.0.1");
  }
});

test("named data volumes and private network retain project ownership without global names", () => {
  const compose = read("infra/compose.json");
  assert.equal(Object.keys(compose.volumes).length, 4);
  for (const resource of [...Object.values(compose.volumes), ...Object.values(compose.networks)]) {
    assert.equal(resource.name, undefined);
    assert.equal(resource.external, undefined);
    assert.equal(resource.labels["io.auto-world.owner"], "${AW_OWNER_TOKEN:?}");
  }
  assert.deepEqual(Object.keys(compose.networks), ["foundation"]);
  assert.equal(compose.networks.foundation.driver, "bridge");
  assert.equal(compose.networks.foundation.internal, false);
  assert.deepEqual(compose.networks.foundation.driver_opts, { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" });
  const serialized = JSON.stringify(compose);
  assert.doesNotMatch(serialized, /docker\.sock|\/var\/run|\bprivileged\b|network_mode/u);
});

test("credentials are required generated inputs and object authentication is explicitly configured", () => {
  const { services } = read("infra/compose.json");
  assert.equal(services.postgres.environment.POSTGRES_PASSWORD, "${AW_PG_BOOTSTRAP_PASSWORD:?}");
  assert.equal(services.postgres.environment.POSTGRES_HOST_AUTH_METHOD, "scram-sha-256");
  assert.equal(services.redis.environment.REDISCLI_AUTH, "${AW_REDIS_PASSWORD:?}");
  assert.ok(services["object-store"].command.some((item) => item.includes("s3.config")));
  assert.ok(services["object-store"].volumes.some((volume) => volume.type === "bind" && volume.read_only === true));
  assert.deepEqual(services["object-store"].entrypoint, ["/bin/sh", "/run/aw/bootstrap.sh"]);
  assert.deepEqual(services["object-store"].tmpfs, ["/run/aw-private:rw,noexec,nosuid,size=1m,mode=0700"]);
  const init = readFileSync(new URL("../infra/object-store-init.sh", import.meta.url), "utf8");
  assert.match(init, /chown 1000:1000 \/run\/aw-private/u);
  assert.doesNotMatch(init, /chmod 0?777|set -x|\r/u);
  assert.equal(services.opensearch.environment.DISABLE_SECURITY_PLUGIN, "true");
  assert.doesNotMatch(JSON.stringify(services), /\$\{AW_[A-Z_]+:-/u);
});

test("only the raw volume disables image skeleton copy-up before empty-target restore", () => {
  const { services } = read("infra/compose.json");
  for (const [name, service] of Object.entries(services)) {
    const data = service.volumes.find((mount) => mount.type === "volume");
    assert.equal(data.volume?.nocopy, name === "object-store" ? true : undefined);
  }
});
