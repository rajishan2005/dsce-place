"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoPosition } from "@/lib/geo";
import { isGeolocationSupported } from "@/lib/geo";

export type GpsStatus =
  | "idle"
  | "requesting"
  | "tracking"
  | "denied"
  | "unavailable"
  | "error";

interface UseGeolocationResult {
  position: GeoPosition | null;
  status: GpsStatus;
  error: string | null;
  supported: boolean;
  start: () => void;
  stop: () => void;
  /** One-shot refresh */
  refresh: () => void;
}

export function useGeolocation(autoStart = false): UseGeolocationResult {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const supported = isGeolocationSupported();

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    setPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? 50,
      heading: pos.coords.heading ?? null,
      timestamp: pos.timestamp,
    });
    setStatus("tracking");
    setError(null);
  }, []);

  const applyError = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      setStatus("denied");
      setError("Location permission denied. Enable GPS for this site.");
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      setStatus("unavailable");
      setError("GPS unavailable right now.");
    } else {
      setStatus("error");
      setError(err.message || "Could not get location.");
    }
  }, []);

  const stop = useCallback(() => {
    if (watchId.current != null && supported) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setStatus((s) => (s === "tracking" || s === "requesting" ? "idle" : s));
  }, [supported]);

  const start = useCallback(() => {
    if (!supported) {
      setStatus("unavailable");
      setError("This browser does not support GPS.");
      return;
    }

    setStatus("requesting");
    setError(null);

    // Clear previous watch
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    watchId.current = navigator.geolocation.watchPosition(
      applyPosition,
      applyError,
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 20_000,
      }
    );
  }, [supported, applyPosition, applyError]);

  const refresh = useCallback(() => {
    if (!supported) return;
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(applyPosition, applyError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20_000,
    });
  }, [supported, applyPosition, applyError]);

  useEffect(() => {
    if (autoStart) start();
    return () => {
      if (watchId.current != null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [autoStart, start]);

  return { position, status, error, supported, start, stop, refresh };
}
