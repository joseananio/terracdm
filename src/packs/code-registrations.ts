import type { CodePackRegistration } from "../lib/server/pack-registry";
import { aviationCodePack } from "./aviation/registration";
import { maritimeCodePack } from "./maritime/registration";
import { spaceCodePack } from "./space/registration";
import { naturalHazardsCodePack } from "./natural-hazards/registration";
import { conflictCodePack } from "./conflict/registration";
import { cyberCodePack } from "./cyber/registration";
import { firesCodePack } from "./fires/registration";
import { cctvCodePack } from "./cctv/registration";
import { newsCodePack } from "./news/registration";
import { sanctionsCodePack } from "./sanctions/registration";
import { telegramCodePack } from "./telegram/registration";

export const builtInCodePackRegistrations: CodePackRegistration[] = [
  aviationCodePack,
  maritimeCodePack,
  spaceCodePack,
  naturalHazardsCodePack,
  conflictCodePack,
  cyberCodePack,
  firesCodePack,
  cctvCodePack,
  newsCodePack,
  sanctionsCodePack,
  telegramCodePack,
];
