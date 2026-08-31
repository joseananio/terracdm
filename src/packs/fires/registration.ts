import { codePackRegistration } from "../code-pack-registration";
import { firesManifest } from "./manifest";
import { firesEonetProviderImplementation, firesFirmsProviderImplementation } from "./provider";
import { firesGraphImplementation } from "../../lib/server/node-graph";

export const firesCodePack = codePackRegistration(firesManifest, { "nasa-firms": firesFirmsProviderImplementation, "nasa-eonet": firesEonetProviderImplementation }, firesGraphImplementation);
