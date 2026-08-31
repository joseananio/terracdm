import { codePackRegistration } from "../code-pack-registration";
import { maritimeManifest } from "./manifest";
import { maritimeProviderImplementation } from "./provider";
import { maritimeGraphImplementation } from "../../lib/server/node-graph";

export const maritimeCodePack = codePackRegistration(maritimeManifest, { [maritimeManifest.providers[0].id]: maritimeProviderImplementation }, maritimeGraphImplementation);
