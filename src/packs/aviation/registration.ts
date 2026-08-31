import { codePackRegistration } from "../code-pack-registration";
import { aviationManifest } from "./manifest";
import { aviationProviderImplementation } from "./provider";
import { aviationGraphImplementation } from "../../lib/server/node-graph";

export const aviationCodePack = codePackRegistration(aviationManifest, { [aviationManifest.providers[0].id]: aviationProviderImplementation }, aviationGraphImplementation);
