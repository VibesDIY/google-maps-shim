import { describe, expect, it } from "vitest";
import { createDetachWatch, type ObserverCtor } from "../src/detach-watch.js";

// The real watcher, driven by a hand-built observer: `flush()` plays the
// browser delivering the mutations queued during a task.

class FakeObserver {
  static live: FakeObserver[] = [];
  observing = false;
  constructor(readonly callback: () => void) {
    FakeObserver.live.push(this);
  }
  observe(): void {
    this.observing = true;
  }
  disconnect(): void {
    this.observing = false;
  }
}

function setup(): { readonly watch: ReturnType<typeof createDetachWatch>; readonly flush: () => void } {
  FakeObserver.live = [];
  const watch = createDetachWatch({
    document: {} as Document,
    MutationObserver: FakeObserver as unknown as ObserverCtor,
  });
  const flush = (): void => {
    for (const o of FakeObserver.live.filter((x) => x.observing)) o.callback();
  };
  return { watch, flush };
}

function box(connected: boolean): { isConnected: boolean } {
  return { isConnected: connected };
}

describe("detach watch", () => {
  it("runs once when a box that was on the page leaves it, then stops observing", () => {
    const { watch, flush } = setup();
    const b = box(true);
    let gone = 0;
    watch(b as unknown as HTMLElement, () => (gone += 1));
    flush();
    expect(gone).toBe(0);
    b.isConnected = false;
    flush();
    flush();
    expect(gone).toBe(1);
    expect(FakeObserver.live[0].observing).toBe(false);
  });

  it("a move inside one task is not a leave, and a box built off the page waits until it has been on it", () => {
    const { watch, flush } = setup();
    const moved = box(true);
    const later = box(false);
    const gone: string[] = [];
    watch(moved as unknown as HTMLElement, () => gone.push("moved"));
    watch(later as unknown as HTMLElement, () => gone.push("later"));
    // removed and put back before the observer runs
    moved.isConnected = false;
    moved.isConnected = true;
    flush();
    expect(gone).toEqual([]);
    later.isConnected = true;
    flush();
    later.isConnected = false;
    flush();
    expect(gone).toEqual(["later"]);
  });

  it("watches nothing where there is no MutationObserver", () => {
    const watch = createDetachWatch({ document: {} as Document, MutationObserver: undefined });
    expect(() => watch(box(true) as unknown as HTMLElement, () => undefined)).not.toThrow();
  });
});
