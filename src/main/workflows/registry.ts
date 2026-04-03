/**
 * Pack registry — imports V1 workflow packs from dedicated pack files.
 */

import { buildDesignSystemPack } from './packs/build-design-system.js';
import { buildScreenPack } from './packs/build-screen.js';
import { updateScreenPack } from './packs/update-screen.js';
import type { WorkflowPack } from './types.js';

const PACKS: WorkflowPack[] = [buildScreenPack, updateScreenPack, buildDesignSystemPack];

const FROZEN_PACKS: readonly WorkflowPack[] = Object.freeze(PACKS);

export function getPackById(id: string): WorkflowPack | undefined {
  return PACKS.find((p) => p.id === id);
}

export function getAllPacks(): readonly WorkflowPack[] {
  return FROZEN_PACKS;
}
