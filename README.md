# TerraCDM

![TerraCDM logo](public/terracdm-logo.svg)

TerraCDM is a situation room for incoming signals, search, relationship graphs, and operational actions.

## Run locally

HTTPS is required for local development. Use the HTTPS development server so browser APIs, media sources, and map interactions run in the same secure context as production.

```bash
pnpm install
pnpm dev
```

The development server runs at **https://localhost:3003**. Next.js generates a self-signed development certificate automatically, so accept the browser certificate warning the first time you open the app. Do not use `pnpm dev:http` for normal development; it is retained only as a diagnostic fallback.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjoseananio%2Fterracdm&env=NEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY%2CSUPABASE_URL%2CSUPABASE_SECRET_KEY%2CCR%5FSECRET%2COPENAI%5FAPI%5FKEY%2CANTHROPIC%5FAPI%5FKEY&envDescription=Optional%20Supabase%20persistence%2C%20cron%20authorization%2C%20and%20server-side%20AI%20provider%20credentials)

The Vercel button provisions the existing Next.js deployment and keeps the
scheduled overview route from `vercel.json`. All provider and persistence
credentials are optional; unconfigured sources report their normal
`key_required` or local-storage fallback state.

### Docker

The production image uses Next.js standalone output and runs as an unprivileged
user. Build and run it directly with:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -t terracdm:local .
docker run --rm -p 3003:3000 --env-file .env terracdm:local
```

For a persistent self-hosted instance, use Compose:

```bash
docker compose up --build -d
curl http://localhost:3003/api/health
```

Compose mounts `terracdm.yaml` read-only, stores local chat/overview/workflow
state in the `terracdm_data` volume, exposes the app on port `3003`, and
passes provider credentials only to the server. Set `TERRACDM_PORT` to use a
different host port. Supabase remains optional and can be supplied through the
server-only variables in `.env`; this package does not bundle a database.

## Delivery plan

1. **Canvas core** — Next.js App Router, MapLibre, D3, Phosphor icons, provider-backed layer rail, live signal ticker, responsive situation-room canvas.
2. **Agentic operations** — server tool registry, traceable plans/evidence, D3 force graph derived from incoming observations, entity drill-in, signal review, and recon actions.
3. **Persistence and live providers** — Supabase watchlists/agent runs, Realtime broadcast boundary, server-side source adapters, and credentials-driven activation of key-gated feeds.

The provider-backed WebGL canvas, domain routes, agent runtime, D3 graph, recon actions, polling refresh, optional Supabase Realtime, and persistence boundary are implemented. Supabase is opt-in through server environment variables; the migrations are ready to apply to the project you explicitly configure.

## Supabase migration deployment

Pushes that change `supabase/migrations/**` deploy migrations automatically: `staging` targets staging and `main` targets production. Configure these GitHub Actions secrets:

- `STAGING_DB_URL`
- `PROD_DB_URL`

The workflow can also be started manually with a staging/production target and an optional dry run. Use `staging` for day-to-day work, then merge `staging` into `main` to release the same migrations to production. The workflow serializes deployments per branch so concurrent migration pushes cannot run against the same project at once.

## MapLibre renderer spike

The isolated `https://localhost:3003/maplibre-spike` route is a bare `react-map-gl/maplibre` canvas. It mounts only after the first intelligence snapshot is available. Its `MAP` base uses the local Esri dark-gray raster tile proxy; `CARTO` uses Carto Dark Matter raster tiles; and `SAT` uses the local satellite proxy. The canvas shares the main map's `3D / 2D` globe projection and base controls; 3D is a globe projection because the Esri basemap is raster-only.

### GPU aviation-renderer fallback

The spike's live aviation nodes are rendered by a MapLibre custom WebGL layer (`aviation-nodes-gpu`), not by DOM markers. The server uses an authenticated OpenSky global snapshot as its primary source, concurrently enriches it with the Airplanes.live and ADSB.lol military, privacy, and emergency feeds, then de-duplicates aircraft by ICAO24. Requests share a 90-second cache and a single in-flight load; an OpenSky 429 triggers a 15-minute cooldown. If the global feed is unavailable, bounded regional ADS-B requests cover an even global grid rather than a handful of hub cities. The fragment shader draws aircraft triangles in the existing map WebGL context, keeping them visible in both 2D and globe modes.

Marker size is data-driven: ADS-B emitter categories (`A1`–`A7`, or the OpenSky numeric equivalent) provide a relative aircraft-size class. Ground tracks are reduced; commercial aircraft are cyan, private jets violet, military tracks red, and other ground tracks muted blue. The provider also normalizes altitude, heading, speed, aircraft class, and ground state for the popup and future filters.

The initial view is progressive: every spike provider except maritime and space is requested independently. The map mounts after the first provider response, then merges later snapshots and repaints the live GPU buffers without blocking on a slow or unavailable source. Spatial records—including fire hotspots, natural-hazard events, conflict zones, broadcaster locations, and cameras—use a second custom WebGL point layer, so they bypass the GeoJSON worker issue and remain selectable on the canvas.

This is a deliberate fallback for the current MapLibre 6.3 integration: the declarative and imperative GeoJSON source paths both register their layers but the `GeoJSONSource` never becomes loaded in the renderer (`isSourceLoaded` remains false and queries return zero features without a MapLibre error). The custom layers keep the spike genuinely GPU-rendered while avoiding that worker/source-ingestion failure. Revisit the GeoJSON path when the underlying MapLibre integration is repaired; the main map still uses DOM markers for its live entity population.

## Media sources and incoming news

Every playable entity carries a typed `media` source. The supported transports are:

- `youtube`: a broadcaster channel live embed with its official page retained as the external source.
- `hls`: an HLS `.m3u8` playlist rendered through the browser video pipeline when supported.
- `mjpeg`: a multipart JPEG stream rendered as a live image.
- `jpg`: a refreshable still frame, used by public traffic-camera registries.
- `iframe`: a publisher-provided embed.
- `external`: an official page opened outside the canvas when embedding is blocked or not published.

The current broadcaster registry is intentionally explicit. CNN, Al Jazeera English, DW, France 24, NHK World, Sky News, TRT World, CNA, and WION use their known YouTube channel IDs for embeds. Bloomberg TV, C-SPAN, CBC News, CGTN, NBC News NOW, CBS News, ABC News Live, and RT News open their official pages because their live streams may block embeds or are not consistently available. The registry does not discover arbitrary YouTube channels at runtime. News signals are separate from playback: GDELT is primary, with BBC World, Al Jazeera, GDACS, TechRadar, CISA, NOAA SPC, NHC, ReliefWeb, and UN News RSS used together as fallback metadata feeds.

The CCTV network combines public traffic-camera authorities across the United Kingdom, United States, Canada, Australia, Singapore, Finland, Iceland, New Zealand, Hong Kong, Austria, and Taiwan. Each adapter is isolated, so one provider can degrade without hiding the others. Camera stills refresh every 30 seconds and fall back through the server-side image proxy when the authority blocks browser-origin image requests. WSDOT has moved its camera inventory behind its free Traveler Information API access code; set server-only `WSDOT_ACCESS_CODE` to enable it.

NASA FIRMS is not configured in this environment: `FIRMS_API_KEY` is absent. The Fire domain keeps NASA FIRMS thermal hotspots separate from the live NASA EONET wildfire-event feed. Add the server-only `FIRMS_API_KEY` to enable the FIRMS sub-pack; it must never be exposed as a `NEXT_PUBLIC_` variable.

HLS means HTTP Live Streaming. An `.m3u8` file is the playlist/manifest that tells a player which live media segments to fetch. GDELT means the Global Database of Events, Language, and Tone; its DOC API returns indexed article metadata and URLs, not a video stream or unrestricted article body.

## Source strategy

The server is provider-agnostic and reports every source as `live`, `cached`, `key_required`, `degraded`, or `unavailable`. Keyless/public coverage includes OpenSky (rate-limited), USGS, NASA EONET, NOAA SWPC, CelesTrak GP, GDELT, NVD 2.0, TfL JamCams, OFAC SDN XML, RDAP, ipwho.is, Blockstream Esplora, Blockscout, Telegram public previews, plus the static maritime port and chokepoint baseline. Set `ACLED_ENABLED=true` together with `ACLED_USERNAME` and `ACLED_PASSWORD` to enable ACLED conflict events: the server obtains a password-grant OAuth token, reuses it for just under 24 hours, and caches the event snapshot for two minutes. Without that flag, the static theater baseline is used. NASA FIRMS, OpenSanctions Search API, and active scanning remain credential/configuration-gated, with explicit public alternatives where available. No protected credential is exposed to the browser.

## Signal packs

TerraCDM is extensible through versioned signal packs. A pack is the shared contract for a domain, its subdomains, providers, normalized signals, map presentation, node fields, graph facts, menus, and agent context. The intelligence route, layer rail, map node sheet, relationship graph, and agent helper contract all read from the same catalog.

Built-in manifests live beside their implementations in `src/packs/*/manifest.ts`, and are assembled by `src/packs/manifests.ts`. To add a trusted declarative pack in an embedding application, add its manifest to `src/lib/catalog/user-packs.ts`. Code-backed packs are registered server-side through the same `registerPack()` API from each pack's `registration.ts`:

The built-in catalog currently contains: Aviation, Maritime, Space,
Natural hazards (USGS earthquakes plus severe-storm and weather-alert feeds),
Conflict zones, Cyber threats, Fire (NASA FIRMS thermal hotspots and NASA EONET
wildfire events), CCTV network, Live broadcast, Sanctions, and Telegram OSINT.
Each pack owns its providers, signal definitions, domain details, node/menu
presentation, graph rules, and agent context/capabilities/tools.

```ts
import type { SignalPackManifest } from "./types";

export const userSignalPackManifests: SignalPackManifest[] = [{
  domain: "air-quality",
  version: "1.0.0",
  label: "Air quality",
  subdomains: [{ id: "station", label: "Stations" }],
  providers: [{
    id: "city-air-quality",
    label: "City air-quality feed",
    sourceId: "city-air-quality",
    type: "http-json",
    endpoint: "https://example.test/air-quality.json",
    pollSeconds: 300,
    mapping: {
      itemsPath: "stations",
      entity: {
        id: { path: "id" }, name: { path: "name" },
        location: { lat: { path: "lat" }, lng: { path: "lng" }, label: { path: "name" } },
        description: { template: "AQI {{aqi}} · {{status}}" }, riskScore: { path: "aqi" },
        properties: { aqi: { path: "aqi" }, status: { path: "status" } },
      },
      signal: {
        id: { template: "air-quality:{{id}}" }, name: { template: "{{status}} air quality" },
        description: { template: "AQI {{aqi}} at {{name}}" }, location: { path: "name" }, riskScore: { path: "aqi" },
      },
    },
  }],
  signals: [{ id: "air-quality.alert", label: "Air-quality alert", providerId: "city-air-quality", subdomainId: "station" }],
  presentation: {
    map: { id: "air-quality", label: "Air quality", short: "AQI", color: "#8de85b", source: "City air-quality feed", status: "live", defaultEnabled: true, details: [{ id: "all", label: "All stations" }] },
    node: { graphNodeType: "event", fields: [{ label: "AQI", value: { path: "properties.aqi" }, format: "number" }] },
    graph: { nodeType: "event", facts: [{ label: "STATUS", value: { path: "properties.status" } }] },
    menu: [{ id: "open-source", label: "OPEN SOURCE", kind: "open-url", url: { path: "url" } }],
  },
}];
```

Provider mappings are the provider boundary only; provider payload names such as
`lat`, `lng`, `title`, or `severity` do not escape it. Every emitted record is
a canonical observation:

```ts
{
  id: "station-1",
  kind: "entity" | "signal",
  domain: "air-quality",
  subdomainId: "station",
  name: "Station 1",
  description: "AQI 20 · good",
  risk: "low" | "medium" | "high",
  riskScore: 20,
  location: { coordinates: { lat: 52, lng: 13 }, label: "Berlin" },
  source: { id: "city-air-quality", name: "City air-quality feed", url: "https://example.test" },
  providerId: "city-air-quality",
  observedAt: "2026-08-23T12:00:00.000Z",
  properties: { aqi: 20, status: "good" },
}
```

`location.label` is the human-readable place name; `location.coordinates` is
the structured geographic position. Entities require coordinates for map
placement, while signals may be label-only. `risk` is the UI-safe bucket and
`riskScore` is the numeric value used by predicates and ranking.

The built-in declarative provider types are `http-json`, `geojson`, `rss`, and `csv`. They support server-side environment-backed credentials, item selection, field mappings, templates, and predicates. Code-backed providers use `type: "code"` plus a server-side `implementation` id, for example `implementation: "pack:aviation"`. For WebSockets, pagination, unusual authentication, or complex graph enrichment, register the implementation through `registerPack()` in `src/lib/server/pack-registry.ts`. Secrets are referenced by environment variable and are never sent through `/api/catalog`.

The public configuration catalog is available at `GET /api/catalog`. Config
loaders can use `GET /api/catalog/packs` for the pack index or
`GET /api/catalog/packs/:packId` for one pack. The payload includes provider
kinds and agent roles, but strips provider environment credentials and tool
handler names. The runtime validates packs with `assertValidSignalPacks()`.
Providers are addressed through `/api/providers/:providerId`; domain-named
provider routes are not part of the runtime surface. The app root is the
MapLibre production surface; the former landing/backup graph implementation
has been removed. The `/api/node-graph` contract accepts canonical
observations plus an optional selected observation id; it does not accept
legacy entity/signal collections.

Multiple contributions may target the same domain. The server assembles
built-in code packs, trusted contributor packs, static user manifests, and
instance YAML/JSON source packs into one domain pack before compilation and
runtime selection. Subdomains, providers, signals, map details, menus, graph
rules, and agent descriptors are unioned in contribution order. Identical
definitions are deduplicated; duplicate ids with different definitions, or
conflicting domain/map metadata, fail assembly rather than silently overriding
an existing contribution. This lets an instance add a provider or subdomain
to an existing domain without creating a second layer or route.

Config-only packs can be loaded from JSON, YAML, or YML on the server with
`loadPackManifestFile()` or `loadPackFile()` in `src/lib/catalog/config/load-pack.ts`.
The loader requires a plain serializable manifest, validates it before
compilation, and rejects code-backed providers, graph resolver ids, and agent
handler references. Register the returned manifest with
`registerPack()` with no implementations; code-backed extensions pass the
server-only implementations to the same function.

The server can select packs and override provider runtime settings from
`terracdm.yaml`. The file is optional and defaults to the repository root;
set `TERRACDM_CONFIG` to use another server-only path. Selection is explicit
when `packs.defaults` is `disabled`, while `enabled` keeps all packs active and
lets individual entries disable or tune a pack:

```yaml
version: 1
packs:
  defaults: disabled
  entries:
    aviation:
      enabled: true
      providers:
        aviation-network:
          pollSeconds: 120
          cache:
            maxAgeSeconds: 120
            staleIfErrorSeconds: 600
    air-quality:
      enabled: true
      source: ./packs/air-quality.yaml
```

Instance `source` paths load config-only packs relative to the instance file.
Provider overrides are limited to endpoint, source status, auth environment
references, polling, cache, coverage, notes, and an enabled switch. They never
replace a code implementation and secrets never belong in YAML. This bootstrap
is server-only; the public catalog exposes only the selected pack metadata.

Server catalog assembly is centralized in
`src/lib/server/catalog-assembly.ts`. It registers built-in code packs, loads
the contributor code-pack registration boundary, loads YAML/JSON config packs,
validates the combined manifests, applies instance selection and provider
overrides, and commits one runtime used by providers, graph, agents, and the
public catalog.

Provider output is normalized into `NormalizedObservation` records at the catalog boundary. Canonical provider snapshots and provider routes expose observations only; the MapLibre client derives temporary entity and signal views locally for rendering. Each observation carries its pack, provider, domain, subdomain, signal type, source, timestamp, and entity/signal kind together.

Graph facts, node types, Wikidata property selections, and local relationship predicates live in each pack's `presentation.graph`. Agent context, capabilities, tools, permissions, and tool handlers live in each pack's `agents` definition and are included in the server-side helper contract.

## Stack

Next.js 16 App Router, TypeScript, MapLibre GL, custom CSS, D3 force simulation, Phosphor Icons, Supabase JS (optional), server route handlers, a provider registry, and standalone Docker/Compose deployment packaging.
