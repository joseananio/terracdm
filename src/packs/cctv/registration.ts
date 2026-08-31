import { codePackRegistration } from "../code-pack-registration";
import { cctvManifest } from "./manifest";
import { cctvProviderImplementation } from "./provider";
import { cctvGraphImplementation } from "../../lib/server/node-graph";

export const cctvCodePack = codePackRegistration(cctvManifest, { [cctvManifest.providers[0].id]: cctvProviderImplementation }, cctvGraphImplementation);
