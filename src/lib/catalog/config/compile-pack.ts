import { compileSignalPack } from "../compiler";
import type { SignalPack } from "../types";
import { assertValidPackConfig } from "./validate-pack";

export function compileConfigPack(input: unknown): SignalPack {
  return compileSignalPack(assertValidPackConfig(input));
}
