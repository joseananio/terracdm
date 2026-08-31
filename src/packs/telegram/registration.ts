import { codePackRegistration } from "../code-pack-registration";
import { telegramManifest } from "./manifest";
import { telegramProviderImplementation } from "./provider";

export const telegramCodePack = codePackRegistration(telegramManifest, { [telegramManifest.providers[0].id]: telegramProviderImplementation });
