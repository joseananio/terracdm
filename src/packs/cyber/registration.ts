import { codePackRegistration } from "../code-pack-registration";
import { cyberManifest } from "./manifest";
import { cyberProviderImplementation } from "./provider";

export const cyberCodePack = codePackRegistration(cyberManifest, { [cyberManifest.providers[0].id]: cyberProviderImplementation });
