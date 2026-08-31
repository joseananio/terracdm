import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const allowedHosts = new Set([
  "content.tfl.gov.uk",
  "s3-eu-west-1.amazonaws.com",
  "s3.amazonaws.com",
  "cwwp2.dot.ca.gov",
  "images.data.gov.sg",
  "weathercam.digitraffic.fi",
  "www.vegagerdin.is",
  "gagnaveita.vegagerdin.is",
  "prod-ut.ibi511.com",
  "511on.ca",
  "511.alberta.ca",
  "drivebc.ca",
  "fl511.com",
  "www.travelmidwest.com",
  "opendata.ndw.nu",
  "thbapp.thb.gov.tw",
  "www.livetraffic.com",
  "webcams.transport.nsw.gov.au",
  "webcams2.asfinag.at",
  "opendata.toronto.ca",
]);

function isAllowedCameraHost(hostname: string) {
  return allowedHosts.has(hostname) || /^cctv-ss0[1-8]\.thb\.gov\.tw$/.test(hostname);
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return NextResponse.json({ error: "Camera URL is required" }, { status: 400 });
  let target: URL;
  try { target = new URL(rawUrl); } catch { return NextResponse.json({ error: "Invalid camera URL" }, { status: 400 }); }
  if (target.protocol !== "https:" || !isAllowedCameraHost(target.hostname)) return NextResponse.json({ error: "Camera source is not allowlisted" }, { status: 403 });

  try {
    const response = await fetch(target, { headers: { accept: "image/avif,image/webp,image/jpeg,image/png,*/*", "user-agent": "TerraCDM/0.1 (situation-room)" }, cache: "no-store" });
    if (!response.ok) return NextResponse.json({ error: `Camera source returned ${response.status}` }, { status: 502 });
    const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!contentType.startsWith("image/")) return NextResponse.json({ error: "Camera source did not return an image" }, { status: 502 });
    return new NextResponse(await response.arrayBuffer(), { headers: { "content-type": contentType, "cache-control": "no-store", "x-content-source": "Public camera proxy" } });
  } catch {
    return NextResponse.json({ error: "Camera source unavailable" }, { status: 502 });
  }
}
