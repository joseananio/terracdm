import { codePackRegistration } from "../code-pack-registration";
import { naturalHazardsManifest } from "./manifest";
import { seismicProviderImplementation } from "../seismic/provider";
import { weatherProviderImplementation } from "../weather/provider";
import { naturalHazardsGraphImplementation } from "../../lib/server/node-graph";

export const naturalHazardsCodePack = codePackRegistration(naturalHazardsManifest, { usgs: seismicProviderImplementation, "weather-stack": weatherProviderImplementation }, naturalHazardsGraphImplementation);
