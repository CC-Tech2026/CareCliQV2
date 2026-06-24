type NominatimResponse = {
  display_name?: string;
};

/** Resolve a human-readable address from GPS coordinates (OpenStreetMap Nominatim). */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "0");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as NominatimResponse;
    const address = (data.display_name || "").trim();
    return address || null;
  } catch {
    return null;
  }
}
