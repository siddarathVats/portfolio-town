"use client";

/**
 * A page opened before a new version of the site went live still asks for its own version's files,
 * and the server keeps only the new one's: the 3D scene, fetched as it is needed, came back missing
 * and the whole page fell over ("Application error"). A phone that keeps a tab open, or reloads it
 * from its own memory, met this after every deploy.
 */
export const isStale = (e: unknown) =>
  /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i.test(
    `${(e as Error)?.name ?? ""} ${(e as Error)?.message ?? e}`,
  );

const KEY = "walk:fresh-at";

/** Load the page afresh, as the version now live. Once a minute at most (a file truly missing must
 *  not set the page reloading forever): false if it has just been tried. */
export function reloadFresh() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}
