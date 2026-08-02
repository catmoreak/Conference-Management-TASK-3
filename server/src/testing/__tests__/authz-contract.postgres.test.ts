import { afterAll, beforeAll, describe } from "vitest";
import { defineAuthzContractSuite } from "../authz-contract-suite.js";
import { isDockerAvailable, startPgTestHarness, type PgTestHarness } from "../pg-harness.js";

const dockerAvailable = isDockerAvailable();

if (!dockerAvailable) {
  console.warn(
    "[authz-contract.postgres.test.ts] Docker is not available in this environment (checked via `docker info`) -- skipping the real-Postgres AuthzStore contract suite. This file is the actual proof the Postgres store matches the in-memory fake; run it somewhere with Docker (e.g. CI) before trusting PgAuthzStore.",
  );
}

describe.skipIf(!dockerAvailable)("Postgres contract container", () => {
  let handle: PgTestHarness;

  beforeAll(async () => {
    handle = await startPgTestHarness();
  }, 120_000);

  afterAll(async () => {
    await handle.stop();
  }, 60_000);

  defineAuthzContractSuite("real Postgres (testcontainers)", () => handle.harness);
});
