/**
 * Geo layer: maps real-world GPS (WGS84) ↔ pixel grid over DSCE campus.
 *
 * The campus artwork is NOT a perfect orthophoto — bounds are approximate.
 * Tune CAMPUS_BOUNDS (and optional CALIBRATION) while standing on known spots
 * so the blue dot lands on the right building.
 */
import { CAMPUS_BOUNDS, GRID_HEIGHT, GRID_WIDTH } from "./config";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GridPoint {
  /** Continuous grid coords (can be fractional for smooth GPS marker) */
  x: number;
  y: number;
}

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number; // meters
  heading: number | null;
  timestamp: number;
}

/** Meters per degree latitude (constant-ish) */
const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Campus width/height in meters from configured bounds */
export function campusSizeMeters() {
  const { west, east, south, north, center } = CAMPUS_BOUNDS;
  const midLat = center.lat;
  return {
    widthM: Math.abs(east - west) * mPerDegLng(midLat),
    heightM: Math.abs(north - south) * M_PER_DEG_LAT,
  };
}

/**
 * Convert GPS → continuous grid coordinates.
 * Assumes map is roughly north-up: north edge = y=0, west edge = x=0.
 */
export function latLngToGrid(lat: number, lng: number): GridPoint & { onCampus: boolean } {
  const { west, east, south, north } = CAMPUS_BOUNDS;
  const x = ((lng - west) / (east - west)) * GRID_WIDTH;
  const y = ((north - lat) / (north - south)) * GRID_HEIGHT;

  // Small margin so near-edge still counts as "on campus" for UI
  const margin = 8;
  const onCampus =
    x >= -margin &&
    x <= GRID_WIDTH + margin &&
    y >= -margin &&
    y <= GRID_HEIGHT + margin;

  return { x, y, onCampus };
}

/** Grid cell / continuous point → approximate lat/lng */
export function gridToLatLng(x: number, y: number): LatLng {
  const { west, east, south, north } = CAMPUS_BOUNDS;
  const lng = west + (x / GRID_WIDTH) * (east - west);
  const lat = north - (y / GRID_HEIGHT) * (north - south);
  return { lat, lng };
}

/** Convert GPS accuracy (meters) to grid radius */
export function accuracyToGridRadius(accuracyM: number, lat: number): number {
  const { widthM, heightM } = campusSizeMeters();
  const mPerGridX = widthM / GRID_WIDTH;
  const mPerGridY = heightM / GRID_HEIGHT;
  const mPerGrid = (mPerGridX + mPerGridY) / 2;
  // Cap so a bad GPS fix doesn't paint the whole map
  return Math.min(GRID_WIDTH * 0.35, Math.max(1.5, accuracyM / mPerGrid));
}

export function formatDistanceFromCampus(lat: number, lng: number): string {
  const { center } = CAMPUS_BOUNDS;
  const dLat = (lat - center.lat) * M_PER_DEG_LAT;
  const dLng = (lng - center.lng) * mPerDegLng(center.lat);
  const m = Math.hypot(dLat, dLng);
  if (m < 1000) return `${Math.round(m)} m from campus center`;
  return `${(m / 1000).toFixed(1)} km from campus center`;
}

export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}
