/**
 * GPS (WGS84) ↔ campus grid
 */
import { CAMPUS_BOUNDS, GRID_HEIGHT, GRID_WIDTH } from "./config";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  timestamp: number;
}

const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function campusSizeMeters() {
  const { west, east, south, north, center } = CAMPUS_BOUNDS;
  return {
    widthM: Math.abs(east - west) * mPerDegLng(center.lat),
    heightM: Math.abs(north - south) * M_PER_DEG_LAT,
  };
}

export function latLngToGrid(lat: number, lng: number): GridPoint & { onCampus: boolean } {
  const { west, east, south, north } = CAMPUS_BOUNDS;
  const x = ((lng - west) / (east - west)) * GRID_WIDTH;
  const y = ((north - lat) / (north - south)) * GRID_HEIGHT;
  const margin = 4;
  const onCampus =
    x >= -margin &&
    x <= GRID_WIDTH + margin &&
    y >= -margin &&
    y <= GRID_HEIGHT + margin;
  return { x, y, onCampus };
}

export function gridToLatLng(x: number, y: number): LatLng {
  const { west, east, south, north } = CAMPUS_BOUNDS;
  return {
    lng: west + (x / GRID_WIDTH) * (east - west),
    lat: north - (y / GRID_HEIGHT) * (north - south),
  };
}

export function accuracyToGridRadius(accuracyM: number): number {
  const { widthM, heightM } = campusSizeMeters();
  const mPerGrid = (widthM / GRID_WIDTH + heightM / GRID_HEIGHT) / 2;
  return Math.min(GRID_WIDTH * 0.3, Math.max(1.2, accuracyM / mPerGrid));
}

export function formatDistanceFromCampus(lat: number, lng: number): string {
  const { center } = CAMPUS_BOUNDS;
  const dLat = (lat - center.lat) * M_PER_DEG_LAT;
  const dLng = (lng - center.lng) * mPerDegLng(center.lat);
  const m = Math.hypot(dLat, dLng);
  if (m < 1000) return `${Math.round(m)} m from campus`;
  return `${(m / 1000).toFixed(1)} km from campus`;
}

export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/** Clamp continuous position into playable grid */
export function clampGrid(x: number, y: number): GridPoint {
  return {
    x: Math.min(GRID_WIDTH - 0.001, Math.max(0, x)),
    y: Math.min(GRID_HEIGHT - 0.001, Math.max(0, y)),
  };
}
