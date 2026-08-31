import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ReverseGeocodeResponse = {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
  };
};

function coordinate(value: string | null, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function conciseName(result: ReverseGeocodeResponse) {
  const address = result.address ?? {};
  const area = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? address.state;
  const name = [area, address.country].filter(Boolean).join(" / ");
  if (name) return name;
  return result.display_name?.split(",").slice(0, 2).join(",").trim() || "UNKNOWN";
}

export async function GET(request: NextRequest) {
  const lat = coordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
  const lng = coordinate(request.nextUrl.searchParams.get("lng"), -180, 180);
  if (lat === null || lng === null) return NextResponse.json({ name: "UNKNOWN" }, { status: 400 });

  const query = new URLSearchParams({ format: "jsonv2", lat: lat.toFixed(4), lon: lng.toFixed(4), zoom: "10", addressdetails: "1" });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query.toString()}`, {
      headers: { accept: "application/json", "user-agent": "TerraCDM/0.1 (situation-room)" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return NextResponse.json({ name: "UNKNOWN" }, { status: 200 });
    const result = await response.json() as ReverseGeocodeResponse;
    return NextResponse.json({ name: conciseName(result), source: "OpenStreetMap Nominatim" }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ name: "UNKNOWN" }, { status: 200 });
  }
}
