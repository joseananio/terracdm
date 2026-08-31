import type { CodePackRegistration } from "./pack-registry";
import { registerPack } from "./pack-registry";

/**
 * Trusted contributor code packs are added here as registrations or imported
 * modules. This is an extension boundary, not a provider/adapter dispatch map.
 */
export const contributorCodePackRegistrations: CodePackRegistration[] = [];

export function registerContributorCodePacks() {
  for (const registration of contributorCodePackRegistrations) registerPack(registration);
}
