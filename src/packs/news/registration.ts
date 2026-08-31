import { codePackRegistration } from "../code-pack-registration";
import { newsManifest } from "./manifest";
import { newsProviderImplementation } from "./provider";
import { newsGraphImplementation } from "../../lib/server/node-graph";

export const newsCodePack = codePackRegistration(newsManifest, { [newsManifest.providers[0].id]: newsProviderImplementation }, newsGraphImplementation);
