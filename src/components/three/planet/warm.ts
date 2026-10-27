/** While on, the town draws every piece regardless of culling (the loader's warm-up frames). */
export const warmUp = { on: false };

/**
 * The layer of each town section's large-shapes version: the sun's shadow camera always sees it, so
 * it casts the town's shadows; the main camera sees it only for far sections.
 */
export const LOD_LAYER = 1;
