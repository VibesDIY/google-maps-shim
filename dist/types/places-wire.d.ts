import type { LatLngBoundsLiteral, LatLngLiteral } from "./core.js";
/** The platform query (api-types PlacesSearchQuery / vibe-types VibePlacesQuery). */
export interface PlacesQueryWire {
    readonly search: "nearby" | "text";
    readonly center: LatLngLiteral;
    readonly radius: number;
    readonly includedTypes?: string[];
    readonly excludedTypes?: string[];
    /** searchNearby's primary-type filters, sent apart for Google; the free map merges them into the type lists. */
    readonly includedPrimaryTypes?: string[];
    readonly excludedPrimaryTypes?: string[];
    /** searchByText's locationRestriction as a box: Google keeps results inside it. */
    readonly restrictTo?: LatLngBoundsLiteral;
    readonly textQuery?: string;
    readonly maxResultCount?: number;
    /** Google mode only. */
    readonly openNow?: boolean;
    readonly minRating?: number;
    readonly priceLevels?: string[];
}
export interface PlaceWire {
    readonly id: string;
    readonly displayName: string;
    readonly location: LatLngLiteral;
    readonly types: readonly string[];
    readonly primaryType?: string;
    readonly formattedAddress?: string;
    readonly websiteURI?: string;
    readonly nationalPhoneNumber?: string;
    readonly openingHoursText?: readonly string[];
    readonly servesVegetarianFood?: boolean;
    readonly distanceMeters?: number;
    readonly rating?: number;
    readonly userRatingCount?: number;
    readonly openNow?: boolean;
    readonly businessStatus?: string;
    readonly googleMapsURI?: string;
}
export interface PlacesResultWire {
    readonly mode: "free" | "google";
    readonly source: string;
    readonly attribution: string;
    readonly places: readonly PlaceWire[];
    /** Why a Google page got a free answer. */
    readonly reason?: string;
}
export type MapMode = "free" | "google";
