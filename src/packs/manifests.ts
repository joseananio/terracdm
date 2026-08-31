import type { SignalPackManifest } from "../lib/catalog/types";
import { aviationManifest } from "./aviation/manifest";
import { maritimeManifest } from "./maritime/manifest";
import { spaceManifest } from "./space/manifest";
import { naturalHazardsManifest } from "./natural-hazards/manifest";
import { conflictManifest } from "./conflict/manifest";
import { cyberManifest } from "./cyber/manifest";
import { firesManifest } from "./fires/manifest";
import { cctvManifest } from "./cctv/manifest";
import { newsManifest } from "./news/manifest";
import { sanctionsManifest } from "./sanctions/manifest";
import { telegramManifest } from "./telegram/manifest";

export const builtInSignalPackManifests: SignalPackManifest[] = [
  aviationManifest,
  maritimeManifest,
  spaceManifest,
  naturalHazardsManifest,
  conflictManifest,
  cyberManifest,
  firesManifest,
  cctvManifest,
  newsManifest,
  sanctionsManifest,
  telegramManifest,
];
