import { codePackRegistration } from "../code-pack-registration";
import { spaceManifest } from "./manifest";
import { spaceProviderImplementation } from "./provider";
import { spaceGraphImplementation } from "../../lib/server/node-graph";

export const spaceCodePack = codePackRegistration(spaceManifest, { [spaceManifest.providers[0].id]: spaceProviderImplementation }, spaceGraphImplementation);
