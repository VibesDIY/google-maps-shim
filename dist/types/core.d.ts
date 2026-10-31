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
export declare class LatLng {
    #private;
    constructor(latOrLiteral: number | LatLngLiteral | LatLng, lng?: number);
    lat(): number;
    lng(): number;
    equals(other: LatLng | LatLngLiteral | null | undefined): boolean;
    toJSON(): LatLngLiteral;
    toString(): string;
    toUrlValue(precision?: number): string;
}
/** Anything shaped like a google.maps.LatLng, including Google's own native one in Google mode. */
export interface LatLngFunctions {
    lat(): number;
    lng(): number;
}
export type LatLngLike = LatLng | LatLngLiteral | LatLngFunctions;
export declare function toLatLng(v: LatLngLike): LatLng;
/** Axis-aligned bounds. The free map does not wrap across the antimeridian. */
export declare class LatLngBounds {
    #private;
    constructor(swOrLiteral?: LatLngLike | LatLngBoundsLiteral | null, ne?: LatLngLike | null);
    extend(point: LatLngLike): this;
    union(other: LatLngBounds | LatLngBoundsLiteral): this;
    isEmpty(): boolean;
    getCenter(): LatLng;
    getNorthEast(): LatLng;
    getSouthWest(): LatLng;
    contains(point: LatLngLike): boolean;
    equals(other: LatLngBounds | LatLngBoundsLiteral | null | undefined): boolean;
    toJSON(): LatLngBoundsLiteral;
    toString(): string;
}
export declare function toLatLngBounds(v: LatLngBounds | LatLngBoundsLiteral): LatLngBounds;
export interface MapsEventListener {
    remove(): void;
}
export type Handler = (...args: never[]) => void;
/**
 * The listener half of google.maps.MVCObject. Subclasses name the events they
 * fire (`eventNames`); any other name throws, so a listener the free map would
 * never call is a visible error rather than a dead handler.
 */
export declare abstract class Evented {
    #private;
    protected abstract readonly eventNames: readonly string[];
    /** Name of this class in error messages, e.g. `Map`. */
    protected abstract readonly className: string;
    /** Called the first time anyone listens for `name`, so a subclass can start forwarding it. */
    protected startForwarding(_name: string): void;
    addListener(name: string, handler: Handler): MapsEventListener;
    /** Fire `name` for every current listener (google.maps.event.trigger). */
    emit(name: string, ...args: unknown[]): void;
    clearListeners(name?: string): void;
}
/** google.maps.event */
export declare const event: {
    addListener(instance: unknown, name: string, handler: Handler): MapsEventListener;
    addListenerOnce(instance: unknown, name: string, handler: Handler): MapsEventListener;
    removeListener(listener: MapsEventListener | null | undefined): void;
    clearListeners(instance: unknown, name: string): void;
    clearInstanceListeners(instance: unknown): void;
    trigger(instance: unknown, name: string, ...args: unknown[]): void;
    addDomListener(): never;
    addDomListenerOnce(): never;
};
