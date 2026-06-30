import { useCallback, useEffect, useState } from "react";

export type GeolocationResult = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type GeolocationErrorCode = "denied" | "unavailable" | "timeout" | "unsupported";

export type UseGeolocationState = {
  location: GeolocationResult | null;
  error: GeolocationErrorCode | null;
  loading: boolean;
  permissionState: PermissionState | "unknown";
  requestLocation: () => Promise<GeolocationResult | null>;
};

function mapGeolocationError(err: GeolocationPositionError): GeolocationErrorCode {
  if (err.code === err.PERMISSION_DENIED) return "denied";
  if (err.code === err.TIMEOUT) return "timeout";
  return "unavailable";
}

export function useGeolocation(): UseGeolocationState {
  const [location, setLocation] = useState<GeolocationResult | null>(null);
  const [error, setError] = useState<GeolocationErrorCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissionState, setPermissionState] = useState<PermissionState | "unknown">("unknown");

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        setPermissionState(status.state);
        status.onchange = () => setPermissionState(status.state);
      })
      .catch(() => setPermissionState("unknown"));
  }, []);

  const requestLocation = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("unsupported");
      return null;
    }
    setLoading(true);
    setError(null);
    return new Promise<GeolocationResult | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          setLocation(next);
          setLoading(false);
          resolve(next);
        },
        (err) => {
          setError(mapGeolocationError(err));
          setLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  }, []);

  return { location, error, loading, permissionState, requestLocation };
}
