// Google's Map has no destroy: an app drops its map by removing the box it
// drew into, and Google cleans up. The free map holds a WebGL context and
// MapLibre's workers, so it releases them the same way: when its box leaves
// the page, the map is removed (#8113 review).

interface ObserverLike {
  observe(target: Node, options: { childList: boolean; subtree: boolean }): void;
  disconnect(): void;
}

export type ObserverCtor = new (callback: () => void) => ObserverLike;

export interface DetachWatchDeps {
  readonly document: Document;
  /** `globalThis.MutationObserver`; absent (server render, old engine) ⇒ nothing is watched. */
  readonly MutationObserver: ObserverCtor | undefined;
}

/**
 * Returns `onDetached(element, onGone)`: `onGone` runs once, after `element`
 * has been on the page and then is not. A move (removed and put back in the
 * same task) is not a detach, since observers run after the task.
 */
export function createDetachWatch(deps: DetachWatchDeps): (element: HTMLElement, onGone: () => void) => void {
  const watched = new Map<HTMLElement, { readonly onGone: () => void; seen: boolean }>();
  let observer: ObserverLike | undefined;

  function check(): void {
    for (const [element, entry] of watched) {
      if (element.isConnected) {
        entry.seen = true;
        continue;
      }
      if (!entry.seen) continue; // built before it was put on the page
      watched.delete(element);
      entry.onGone();
    }
    if (watched.size === 0 && observer !== undefined) {
      observer.disconnect();
      observer = undefined;
    }
  }

  return (element, onGone) => {
    const Ctor = deps.MutationObserver;
    if (Ctor === undefined) return;
    watched.set(element, { onGone, seen: element.isConnected });
    if (observer === undefined) {
      observer = new Ctor(check);
      observer.observe(deps.document, { childList: true, subtree: true });
    }
  };
}
