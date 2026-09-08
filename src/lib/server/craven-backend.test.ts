import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeWithCraven } from "./craven-backend.ts";

test("keeps TerraCDM explicitly standalone without Craven configuration", async () => {
  const original = [process.env.CRAVEN_BASE_URL, process.env.CRAVEN_PROJECT_ID, process.env.CRAVEN_API_TOKEN, process.env.CRAVEN_ONTOLOGY_MAPPINGS];
  delete process.env.CRAVEN_BASE_URL; delete process.env.CRAVEN_PROJECT_ID; delete process.env.CRAVEN_API_TOKEN; delete process.env.CRAVEN_ONTOLOGY_MAPPINGS;
  try { assert.deepEqual(await synchronizeWithCraven([]), { mode: "standalone", synced: 0, failed: 0, corrections: 0, reason: "Craven integration is not configured." }); }
  finally {
    for (const [key, value] of ["CRAVEN_BASE_URL", "CRAVEN_PROJECT_ID", "CRAVEN_API_TOKEN", "CRAVEN_ONTOLOGY_MAPPINGS"].map((key, index) => [key, original[index]] as const)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
