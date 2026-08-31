import { codePackRegistration } from "../code-pack-registration";
import { sanctionsManifest } from "./manifest";
import { sanctionsProviderImplementation } from "./provider";

export const sanctionsCodePack = codePackRegistration(sanctionsManifest, { [sanctionsManifest.providers[0].id]: sanctionsProviderImplementation });
