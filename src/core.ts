import { notInFreeMap } from "./errors.js";

// google.maps core value types and events, as the Maps JavaScript API shapes
// them: LatLng with lat()/lng() methods, LatLngBounds that grows by extend(),
// and listeners that hand back `{ remove() }`.

export interface LatLngLiteral {
  readonly lat: number;
  readonly lng: number;
}

export interface LatLngBoundsLiteral {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

function isLatLngLiteral(v: unknown): v is LatLngLiteral {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as LatLngLiteral).lat === "number" &&
    typeof (v as LatLngLiteral).lng === "number"
  );
}

export class LatLng {
  readonly #lat: number;
  readonly #lng: number;

  constructor(latOrLiteral: number | LatLngLiteral | LatLng, lng?: number) {
    const lat =
      latOrLiteral instanceof LatLng ? latOrLiteral.lat() : isLatLngLiteral(latOrLiteral) ? latOrLiteral.lat : latOrLiteral;
    const lon = latOrLiteral instanceof LatLng ? latOrLiteral.lng() : isLatLngLiteral(latOrLiteral) ? latOrLiteral.lng : lng;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`LatLng needs a finite lat and lng (got ${String(lat)}, ${String(lon)})`);
    }
    this.#lat = Math.max(-90, Math.min(90, lat));
    this.#lng = lon;
  }

  lat(): number {
    return this.#lat;
  }

  lng(): number {
    return this.#lng;
  }

  equals(other: LatLng | LatLngLiteral | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    const o = toLatLng(other);
    return Math.abs(o.lat() - this.#lat) < 1e-9 && Math.abs(o.lng() - this.#lng) < 1e-9;
  }

  toJSON(): LatLngLiteral {
    return { lat: this.#lat, lng: this.#lng };
  }

  toString(): string {
    return `(${this.#lat}, ${this.#lng})`;
  }

  toUrlValue(precision = 6): string {
    return `${Number(this.#lat.toFixed(precision))},${Number(this.#lng.toFixed(precision))}`;
  }
}

/** Anything shaped like a google.maps.LatLng, including Google's own native one in Google mode. */
export interface LatLngFunctions {
  lat(): number;
  lng(): number;
}

function isLatLngFunctions(v: unknown): v is LatLngFunctions {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as LatLngFunctions).lat === "function" &&
    typeof (v as LatLngFunctions).lng === "function"
  );
}

export type LatLngLike = LatLng | LatLngLiteral | LatLngFunctions;

export function toLatLng(v: LatLngLike): LatLng {
  if (v instanceof LatLng) return v;
  if (isLatLngLiteral(v)) return new LatLng(v.lat, v.lng);
  if (isLatLngFunctions(v)) return new LatLng(v.lat(), v.lng());
  throw new Error("expected a LatLng or a { lat, lng } literal");
}

function isBoundsLiteral(v: unknown): v is LatLngBoundsLiteral {
  const b = v as LatLngBoundsLiteral;
  return typeof v === "object" && v !== null && [b.north, b.south, b.east, b.west].every((n) => typeof n === "number");
}

/** Axis-aligned bounds. The free map does not wrap across the antimeridian. */
export class LatLngBounds {
  #south = Infinity;
  #west = Infinity;
  #north = -Infinity;
  #east = -Infinity;

  constructor(swOrLiteral?: LatLngLike | LatLngBoundsLiteral | null, ne?: LatLngLike | null) {
    if (isBoundsLiteral(swOrLiteral)) {
      this.extend({ lat: swOrLiteral.south, lng: swOrLiteral.west });
      this.extend({ lat: swOrLiteral.north, lng: swOrLiteral.east });
      return;
    }
    if (swOrLiteral !== undefined && swOrLiteral !== null) this.extend(swOrLiteral);
    if (ne !== undefined && ne !== null) this.extend(ne);
  }

  extend(point: LatLngLike): this {
    const p = toLatLng(point);
    this.#south = Math.min(this.#south, p.lat());
    this.#north = Math.max(this.#north, p.lat());
    this.#west = Math.min(this.#west, p.lng());
    this.#east = Math.max(this.#east, p.lng());
    return this;
  }

  union(other: LatLngBounds | LatLngBoundsLiteral): this {
    const o = toLatLngBounds(other);
    if (o.isEmpty()) return this;
    this.extend(o.getSouthWest());
    this.extend(o.getNorthEast());
    return this;
  }

  isEmpty(): boolean {
    return this.#south > this.#north;
  }

  getCenter(): LatLng {
    if (this.isEmpty()) throw new Error("LatLngBounds.getCenter on empty bounds: extend() it with a point first");
    return new LatLng((this.#south + this.#north) / 2, (this.#west + this.#east) / 2);
  }

  getNorthEast(): LatLng {
    if (this.isEmpty()) throw new Error("LatLngBounds.getNorthEast on empty bounds: extend() it with a point first");
    return new LatLng(this.#north, this.#east);
  }

  getSouthWest(): LatLng {
    if (this.isEmpty()) throw new Error("LatLngBounds.getSouthWest on empty bounds: extend() it with a point first");
    return new LatLng(this.#south, this.#west);
  }

  contains(point: LatLngLike): boolean {
    const p = toLatLng(point);
    return p.lat() >= this.#south && p.lat() <= this.#north && p.lng() >= this.#west && p.lng() <= this.#east;
  }

  equals(other: LatLngBounds | LatLngBoundsLiteral | null | undefined): boolean {
    if (other === null || other === undefined) return false;
    const o = toLatLngBounds(other).toJSON();
    const t = this.toJSON();
    return o.north === t.north && o.south === t.south && o.east === t.east && o.west === t.west;
  }

  toJSON(): LatLngBoundsLiteral {
    return { north: this.#north, south: this.#south, east: this.#east, west: this.#west };
  }

  toString(): string {
    return `((${this.#south}, ${this.#west}), (${this.#north}, ${this.#east}))`;
  }
}

export function toLatLngBounds(v: LatLngBounds | LatLngBoundsLiteral): LatLngBounds {
  return v instanceof LatLngBounds ? v : new LatLngBounds(v);
}

// ── Events ──────────────────────────────────────────────────────────────────

export interface MapsEventListener {
  remove(): void;
}

export type Handler = (...args: never[]) => void;

/**
 * The listener half of google.maps.MVCObject. Subclasses name the events they
 * fire (`eventNames`); any other name throws, so a listener the free map would
 * never call is a visible error rather than a dead handler.
 */
export abstract class Evented {
  readonly #listeners = new Map<string, Set<Handler>>();

  protected abstract readonly eventNames: readonly string[];
  /** Name of this class in error messages, e.g. `Map`. */
  protected abstract readonly className: string;

  /** Called the first time anyone listens for `name`, so a subclass can start forwarding it. */
  protected startForwarding(_name: string): void {
    /* most classes fire their events themselves */
  }

  addListener(name: string, handler: Handler): MapsEventListener {
    if (!this.eventNames.includes(name)) throw notInFreeMap(`${this.className} event "${name}"`);
    if (typeof handler !== "function") throw new Error(`${this.className}.addListener("${name}") needs a function`);
    let set = this.#listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(name, set);
      this.startForwarding(name);
    }
    set.add(handler);
    return { remove: () => set.delete(handler) };
  }

  /** Fire `name` for every current listener (google.maps.event.trigger). */
  emit(name: string, ...args: unknown[]): void {
    for (const handler of [...(this.#listeners.get(name) ?? [])]) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }

  clearListeners(name?: string): void {
    if (name === undefined) {
      this.#listeners.forEach((set) => set.clear());
      return;
    }
    this.#listeners.get(name)?.clear();
  }
}

interface Listenable {
  addListener(name: string, handler: Handler): MapsEventListener;
}

function isListenable(v: unknown): v is Listenable {
  return typeof v === "object" && v !== null && typeof (v as Listenable).addListener === "function";
}

/** google.maps.event */
export const event = {
  addListener(instance: unknown, name: string, handler: Handler): MapsEventListener {
    if (!isListenable(instance)) throw notInFreeMap(`event.addListener on this object`);
    return instance.addListener(name, handler);
  },
  addListenerOnce(instance: unknown, name: string, handler: Handler): MapsEventListener {
    if (!isListenable(instance)) throw notInFreeMap(`event.addListenerOnce on this object`);
    const listener = instance.addListener(name, ((...args: never[]) => {
      listener.remove();
      handler(...args);
    }) as Handler);
    return listener;
  },
  removeListener(listener: MapsEventListener | null | undefined): void {
    listener?.remove();
  },
  clearListeners(instance: unknown, name: string): void {
    if (instance instanceof Evented) instance.clearListeners(name);
  },
  clearInstanceListeners(instance: unknown): void {
    if (instance instanceof Evented) instance.clearListeners();
  },
  trigger(instance: unknown, name: string, ...args: unknown[]): void {
    if (!(instance instanceof Evented)) throw notInFreeMap(`event.trigger on this object`);
    instance.emit(name, ...args);
  },
  addDomListener(): never {
    throw notInFreeMap("event.addDomListener (use element.addEventListener)");
  },
  addDomListenerOnce(): never {
    throw notInFreeMap("event.addDomListenerOnce (use element.addEventListener)");
  },
};
