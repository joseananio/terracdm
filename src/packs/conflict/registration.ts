import { codePackRegistration } from "../code-pack-registration";
import { conflictManifest } from "./manifest";
import { conflictProviderImplementation } from "./provider";
import { conflictGraphImplementation } from "../../lib/server/node-graph";

export const conflictCodePack = codePackRegistration(conflictManifest, { [conflictManifest.providers[0].id]: conflictProviderImplementation }, conflictGraphImplementation);
