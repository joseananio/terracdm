import assert from "node:assert/strict";
import test from "node:test";
import { ByteLruCache } from "./byte-lru-cache.ts";

test("evicts least-recently-used values to stay within its byte budget", () => {
  const cache = new ByteLruCache<string, number>(10, (bytes) => bytes);
  cache.set("first", 4);
  cache.set("second", 4);
  assert.equal(cache.get("first"), 4);

  cache.set("third", 4);

  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("first"), 4);
  assert.equal(cache.get("third"), 4);
  assert.equal(cache.byteSize, 8);
});

test("does not cache a value larger than the entire byte budget", () => {
  const cache = new ByteLruCache<string, number>(10, (bytes) => bytes);
  cache.set("kept", 4);

  assert.equal(cache.set("oversized", 11), false);
  assert.equal(cache.get("kept"), 4);
  assert.equal(cache.get("oversized"), undefined);
  assert.equal(cache.byteSize, 4);
});

test("accounts for replacement sizes without leaking the previous value", () => {
  const cache = new ByteLruCache<string, number>(10, (bytes) => bytes);
  cache.set("tile", 8);
  cache.set("tile", 3);

  assert.equal(cache.size, 1);
  assert.equal(cache.byteSize, 3);
});
