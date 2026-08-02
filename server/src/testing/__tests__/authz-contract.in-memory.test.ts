import { defineAuthzContractSuite } from "../authz-contract-suite.js";
import { createInMemoryHarness } from "../in-memory-harness.js";

const harness = createInMemoryHarness();

defineAuthzContractSuite("in-memory fake", () => harness);
