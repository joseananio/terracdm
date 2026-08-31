"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Anchor, X } from "@phosphor-icons/react";
import Map, { Marker, NavigationControl, Popup, type MapRef } from "react-map-gl/maplibre";
import type { CustomLayerInterface, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { defaultLayerIds, Domain, Entity, IntelligenceSnapshot, CanonicalProviderSnapshot, Signal, layerDetails, layers } from "@/src/lib/intelligence";
import { LayerRail } from "@/src/components/layer-rail";
import { IncomingSignalQueue } from "@/src/components/incoming-signal-queue";
import { MapHud, useMapLocation } from "@/src/components/map-hud";
import { defaultMapSettings, normalizeMapSettings, type MapSettings } from "@/src/lib/map-settings";
import { ActionDeck } from "@/src/components/action-deck";
import { AgentSheet } from "@/src/components/agent-sheet";
import { DeterministicActionSheet } from "@/src/components/deterministic-action-sheet";
import type { DeterministicAction } from "@/src/lib/deterministic-actions";
import { getFeedStatus, type FeedStatus } from "@/src/lib/feed-status";
import { MapNodeSheet } from "@/src/components/map-node-sheet";
import { NodeGraphSheet } from "@/src/components/node-graph-sheet";
import { geosearchZoom, type GeosearchResult } from "@/src/lib/geosearch";
import type { ChatReference } from "@/src/lib/server/chat";
import { setSignalQueueOpen } from "@/src/lib/signal-queue-store";
import { getCatalog } from "@/src/lib/catalog/registry";
import { observationsToEntities, observationsToSignals } from "@/src/lib/catalog/observations";
import { isFireDomainId } from "@/src/lib/catalog/domains";
import type { ProviderRequest, ProviderViewport } from "@/src/lib/catalog/types";

type DirectionalRenderNode = {
  id: string;
  coordinates: [number, number];
  heading: number;
  size: number;
  color: [number, number, number];
  entity: Entity;
};
type IntelPointRenderNode = {
  id: string;
  coordinates: [number, number];
  size: number;
  glyph: "point" | "fire" | "reticle";
  color: [number, number, number];
  entity: Entity;
};
type SpikeHudState = { zoom: number; center: [number, number]; cursor: [number, number] | null; scaleKm: number };
type SignalPanelDragState = { startX: number; startY: number; baseX: number; baseY: number; minX: number; maxX: number; minY: number; maxY: number };
export type WorkspaceSearchSelection = (
  | { kind: "place"; value: GeosearchResult }
  | { kind: "signal"; value: Signal }
  | { kind: "entity"; value: Entity }
) & { token: number };
export type WorkspaceSearchCorpus = { signals: Signal[]; entities: Entity[] };
export type WorkspaceToolRequest = { kind: "chat" | "actions"; anchorX: number; token: number; prompt?: string; references?: ChatReference[] };
export type WorkspaceToolState = { chatOpen: boolean; actionsOpen: boolean };
export type WorkspaceMapSettingsState = { settings: MapSettings; ready: boolean };
export type WorkspaceMapSettingsRequest = { change: Partial<MapSettings>; token: number };
type ShippingLaneCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { corridor: string };
    geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  }>;
};

const spikeDomains = layers.map((layer) => layer.id);
const providerRoutes = getCatalog().providers.map((provider) => ({ providerId: provider.id, domain: provider.domain, url: `/api/providers/${encodeURIComponent(provider.id)}` }));
const defaultDetailState: Record<string, string[]> = Object.fromEntries(layers.map((layer) => [layer.id, defaultLayerIds.includes(layer.id) && spikeDomains.includes(layer.id) ? ["all"] : []]));
const satelliteTiles = "/api/tiles/satellite/{z}/{x}/{y}";
const darkStyle: StyleSpecification = {
  version: 8,
  sources: {
    street: { type: "raster", tiles: ["/api/tiles/street/{z}/{x}/{y}?v=dark-gray"], tileSize: 256, maxzoom: 19, attribution: "© Esri" },
    "street-reference": { type: "raster", tiles: ["/api/tiles/street-reference/{z}/{x}/{y}?v=dark-gray"], tileSize: 256, maxzoom: 19, attribution: "© Esri" },
    satellite: { type: "raster", tiles: [satelliteTiles], tileSize: 256, maxzoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" },
  },
  layers: [
    { id: "street", type: "raster", source: "street", paint: { "raster-opacity": 0.94, "raster-saturation": 0.05, "raster-contrast": 0.1, "raster-brightness-min": 0.02, "raster-brightness-max": 0.66 } },
    { id: "street-reference", type: "raster", source: "street-reference", paint: { "raster-opacity": 0.62, "raster-saturation": 0, "raster-contrast": 0.65, "raster-brightness-min": 0, "raster-brightness-max": 0.78 } },
    { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" }, paint: { "raster-opacity": 0.84, "raster-saturation": -0.22, "raster-contrast": 0.12, "raster-brightness-min": 0.04, "raster-brightness-max": 0.62 } },
  ],
};

// These are broad, static navigation corridors—not inferred vessel tracks.
// Keeping them local makes the maritime context available even when AIS is unavailable.
const shippingLanesGeoJson: ShippingLaneCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { corridor: "North Atlantic" },
      geometry: { type: "LineString", coordinates: [[4.5, 51.9], [-5.5, 50.2], [-20, 48], [-38, 44], [-57, 41], [-74, 40.7]] },
    },
    {
      type: "Feature",
      properties: { corridor: "Europe to Suez" },
      geometry: { type: "LineString", coordinates: [[4.5, 51.9], [-5.5, 50.2], [-9.5, 43], [-5.6, 36], [3, 36], [14, 35], [24, 35], [32.5, 30.4]] },
    },
    {
      type: "Feature",
      properties: { corridor: "Suez to Singapore" },
      geometry: { type: "LineString", coordinates: [[32.5, 30.4], [34.8, 28.5], [43.3, 12.6], [50.5, 12.2], [57, 17], [67, 19], [73, 10], [80, 6], [94, 5], [103.8, 1.3]] },
    },
    {
      type: "Feature",
      properties: { corridor: "Cape route" },
      geometry: { type: "LineString", coordinates: [[4.5, 51.9], [-5.5, 50.2], [-10, 35], [-16, 15], [-8, -5], [6, -25], [18.5, -34], [38, -30], [57, -15], [73, 1], [94, 5], [103.8, 1.3]] },
    },
    {
      type: "Feature",
      properties: { corridor: "Persian Gulf to Asia" },
      geometry: { type: "LineString", coordinates: [[56.3, 26.5], [58.8, 24.5], [63, 23], [68, 20], [73, 10], [80, 6], [94, 5], [103.8, 1.3]] },
    },
    {
      type: "Feature",
      properties: { corridor: "East Africa to Asia" },
      geometry: { type: "LineString", coordinates: [[39.7, -4], [47, -5], [58, -4], [73, 1], [80, 6], [94, 5], [103.8, 1.3]] },
    },
    {
      type: "Feature",
      properties: { corridor: "Trans-Pacific" },
      geometry: { type: "LineString", coordinates: [[121.5, 31.2], [130, 34], [141, 36], [155, 37], [170, 34], [-170, 31], [-155, 27], [-140, 25], [-125, 29], [-118.2, 33.7]] },
    },
    {
      type: "Feature",
      properties: { corridor: "Panama route" },
      geometry: { type: "LineString", coordinates: [[-118.2, 33.7], [-105, 25], [-91, 14], [-79.6, 9.1], [-77, 12], [-75, 20], [-75, 31], [-74, 40.7]] },
    },
    {
      type: "Feature",
      properties: { corridor: "South American east coast" },
      geometry: { type: "LineString", coordinates: [[-79.6, 9.1], [-76, 4], [-64, -10], [-48, -23], [-43, -23], [-38, -14], [-30, 0], [-28, 15], [-38, 44]] },
    },
  ],
};

const emptySnapshot: IntelligenceSnapshot = { fetchedAt: "", viewport: { west: -180, south: -60, east: 180, north: 80 }, snapshots: [], observations: [] };

function failedProviderSnapshot(domain: Domain, providerId: string, cause: unknown): CanonicalProviderSnapshot {
  const layer = layers.find((item) => item.id === domain);
  return {
    domain,
    source: { id: providerId, name: layer?.source ?? `${domain} provider` },
    providerId,
    status: "error",
    fetchedAt: new Date().toISOString(),
    observations: [],
    packId: domain,
    error: cause instanceof Error ? cause.message : "Provider request failed",
  };
}
function mergeSnapshot(current: IntelligenceSnapshot, incoming: Pick<IntelligenceSnapshot, "snapshots" | "observations">, viewport?: ProviderViewport): IntelligenceSnapshot {
  const incomingProviders = new Set(incoming.snapshots.map((item) => item.providerId));
  const snapshots = [...current.snapshots.filter((item) => !incomingProviders.has(item.providerId)), ...incoming.snapshots];
  const observations = snapshots.flatMap((item) => item.observations ?? []);
  return {
    ...current,
    fetchedAt: new Date().toISOString(),
    viewport: viewport ?? current.viewport,
    snapshots,
    observations,
  };
}

function viewportForMap(map: MapLibreMap): ProviderViewport {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}

function signalNode(signal: Signal): Entity {
  const coordinates = signal.location?.coordinates;
  return {
    id: `signal:${signal.id}`,
    kind: "entity",
    domain: signal.domain,
    subdomainId: signal.subdomainId,
    name: signal.name,
    description: signal.description,
    risk: signal.risk,
    riskScore: signal.riskScore,
    location: { coordinates: coordinates ?? { lat: 0, lng: 0 }, label: signal.location?.label },
    source: signal.source,
    providerId: signal.providerId,
    observedAt: signal.observedAt,
    url: signal.url,
    media: signal.imageUrl ? { kind: "jpg", url: signal.imageUrl } : undefined,
    properties: { detail: signal.description },
  };
}

function aircraftSize(entity: Entity) {
  const category = String(entity.properties?.category ?? "").trim().toUpperCase();
  const classSize: Record<string, number> = { A1: 16, A2: 18, A3: 20, A4: 23, A5: 27, A6: 22, A7: 18, "1": 16, "2": 18, "3": 20, "4": 23, "5": 27, "6": 22, "7": 18 };
  const base = classSize[category] ?? 18;
  return entity.properties?.onGround === true ? Math.max(16, base) : Math.round(base * 1.3);
}

function aircraftColor(entity: Entity): [number, number, number] {
  const aircraftClass = String(entity.properties?.aircraftClass ?? "");
  if (aircraftClass === "commercial") return [0.18, 0.85, 1];
  if (aircraftClass === "private") return [1, 0.70, 0.30];
  if (aircraftClass === "private-jets") return [0.76, 0.56, 1];
  if (aircraftClass === "military") return [1, 0.35, 0.39];
  return entity.properties?.onGround === true ? [0.34, 0.56, 0.64] : [0.72, 0.82, 0.86];
}

function layerColor(domain: Domain): [number, number, number] {
  const hex = layers.find((layer) => layer.id === domain)?.color ?? "#aab8c2";
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

function toAircraftNodes(entities: Entity[]): DirectionalRenderNode[] {
  return entities
    .filter((entity) => entity.domain === "aviation" && Number.isFinite(entity.location.coordinates.lat) && Number.isFinite(entity.location.coordinates.lng))
    .map((entity) => ({
      id: entity.id,
      coordinates: [entity.location.coordinates.lng, entity.location.coordinates.lat] as [number, number],
      heading: Number(entity.properties?.heading ?? 0),
      size: aircraftSize(entity),
      color: aircraftColor(entity),
      entity,
    }));
}

function maritimeColor(entity: Entity): [number, number, number] {
  switch (entity.properties?.vesselClass) {
    case "military": return [1, 0.35, 0.39];
    case "tanker": return [1, 0.65, 0.31];
    case "cargo": return [0.38, 0.9, 0.48];
    default: return [0.4, 0.88, 0.71];
  }
}

function toMaritimeNodes(entities: Entity[]): DirectionalRenderNode[] {
  return entities
    .filter((entity) => entity.domain === "maritime" && entity.properties?.kind === "vessel" && Number(entity.properties?.speed ?? 0) > 0.5 && Number.isFinite(entity.location.coordinates.lat) && Number.isFinite(entity.location.coordinates.lng))
    .map((entity) => ({
      id: entity.id,
      coordinates: [entity.location.coordinates.lng, entity.location.coordinates.lat] as [number, number],
      heading: Number(entity.properties?.heading ?? 0),
      size: Math.min(26, 16 + Number(entity.properties?.speed ?? 0) * 0.55),
      color: maritimeColor(entity),
      entity,
    }));
}

function toSatelliteNodes(entities: Entity[]): DirectionalRenderNode[] {
  return entities
    .filter((entity) => entity.domain === "space" && Number.isFinite(entity.location.coordinates.lat) && Number.isFinite(entity.location.coordinates.lng))
    .map((entity) => ({
      id: entity.id,
      coordinates: [entity.location.coordinates.lng, entity.location.coordinates.lat] as [number, number],
      heading: Number(entity.properties?.noradId ?? 0) % 360,
      size: 20,
      color: layerColor("space"),
      entity,
    }));
}

function toIntelPointNodes(entities: Entity[]): IntelPointRenderNode[] {
  return entities
    .filter((entity) => entity.domain !== "aviation" && entity.domain !== "maritime" && entity.domain !== "space" && Number.isFinite(entity.location.coordinates.lat) && Number.isFinite(entity.location.coordinates.lng))
    .map((entity) => ({
      id: entity.id,
      coordinates: [entity.location.coordinates.lng, entity.location.coordinates.lat] as [number, number],
      size: isFireDomainId(entity.domain) ? 18 + Math.round((entity.riskScore ?? 0) / 24) : ["natural-hazards", "conflict"].includes(entity.domain) ? 25 + Math.round((entity.riskScore ?? 0) / 16) : entity.domain === "news" ? 28 : entity.domain === "cctv" ? 22 : 22,
      glyph: isFireDomainId(entity.domain) ? "fire" : entity.domain === "cctv" ? "reticle" : "point",
      color: layerColor(entity.domain),
      entity,
    }));
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create aviation shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Aviation shader compilation failed");
  return shader;
}

function isOnFrontGlobeHemisphere(center: [number, number], coordinates: [number, number]) {
  const radians = Math.PI / 180;
  const centerLatitude = center[1] * radians;
  const latitude = coordinates[1] * radians;
  const longitudeDelta = (coordinates[0] - center[0]) * radians;
  const hemisphereDot = Math.sin(centerLatitude) * Math.sin(latitude)
    + Math.cos(centerLatitude) * Math.cos(latitude) * Math.cos(longitudeDelta);

  // Custom WebGL layers draw in screen coordinates, so MapLibre cannot hide their
  // back-side points for us. Keep a small margin inside the horizon as well.
  return hemisphereDot > 0.015;
}

function isMapCoordinateVisible(map: MapLibreMap, coordinates: [number, number]) {
  if (map.getProjection().type !== "globe") return true;
  const center = map.getCenter();
  return isOnFrontGlobeHemisphere([center.lng, center.lat], coordinates);
}

function createDirectionalRenderer(id: string, nodesRef: { current: DirectionalRenderNode[] }, glyph: "aircraft" | "satellite" | "vessel"): CustomLayerInterface {
  let map: MapLibreMap;
  let program: WebGLProgram;
  let buffer: WebGLBuffer;
  const vertexSource = `#version 300 es
    in vec2 position;
    in float size;
    in float angle;
    in vec3 color;
    out float v_angle;
    out vec3 v_color;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
      gl_PointSize = size;
      v_angle = angle;
      v_color = color;
    }`;
  const fragmentSource = glyph === "aircraft" ? `#version 300 es
    precision highp float;
    in float v_angle;
    in vec3 v_color;
    out vec4 outColor;
    void main() {
      vec2 point = gl_PointCoord * 2.0 - 1.0;
      point.y = -point.y;
      float c = cos(-v_angle);
      float s = sin(-v_angle);
      vec2 local = mat2(c, -s, s, c) * point;
      float fuselage = local.y > 0.56 ? max(0.0, 0.085 + (0.91 - local.y) * 0.56) : 0.10;
      float sweptWings = local.y > -0.40 && local.y < 0.23 ? max(0.0, 0.88 - abs(local.y + 0.08) * 1.65) : 0.0;
      float stabilizer = local.y > -0.70 && local.y < -0.50 ? max(0.0, 0.19 - abs(local.y + 0.60) * 0.74) : 0.0;
      float halfWidth = max(fuselage, max(sweptWings, stabilizer));
      if (local.y < -0.80 || local.y > 0.91 || abs(local.x) > halfWidth) discard;
      float edge = smoothstep(0.0, 0.075, halfWidth - abs(local.x));
      outColor = vec4(v_color * (0.78 + edge * 0.22), edge);
    }` : glyph === "satellite" ? `#version 300 es
    precision highp float;
    in float v_angle;
    in vec3 v_color;
    out vec4 outColor;
    void main() {
      vec2 point = gl_PointCoord * 2.0 - 1.0;
      point.y = -point.y;
      float c = cos(-v_angle);
      float s = sin(-v_angle);
      vec2 local = mat2(c, -s, s, c) * point;
      float body = local.y > 0.58 ? max(0.0, 0.10 + (0.88 - local.y) * 0.54) : 0.105;
      float wings = local.y > -0.18 && local.y < 0.26 ? max(0.0, 0.86 - abs(local.y - 0.02) * 1.7) : 0.0;
      float tail = local.y > -0.76 && local.y < -0.43 ? max(0.0, 0.31 - abs(local.y + 0.60) * 0.72) : 0.0;
      float halfWidth = max(body, max(wings, tail));
      if (local.y < -0.86 || local.y > 0.90 || abs(local.x) > halfWidth) discard;
      float edge = smoothstep(0.0, 0.075, halfWidth - abs(local.x));
      outColor = vec4(v_color * (0.78 + edge * 0.22), edge);
    }` : `#version 300 es
    precision highp float;
    in float v_angle;
    in vec3 v_color;
    out vec4 outColor;
    void main() {
      vec2 point = gl_PointCoord * 2.0 - 1.0;
      point.y = -point.y;
      float c = cos(-v_angle);
      float s = sin(-v_angle);
      vec2 local = mat2(c, -s, s, c) * point;
      if (local.y < -0.78 || local.y > 0.95 || abs(local.x) > (0.95 - local.y) * 0.72) discard;
      float edge = smoothstep(0.96, 0.72, max(abs(local.x) / max((0.95 - local.y) * 0.72, 0.001), abs(local.y)));
      outColor = vec4(v_color * (0.72 + edge * 0.28), 1.0);
    }`;

  return {
    id,
    type: "custom",
    renderingMode: "2d",
    onAdd(nextMap, gl) {
      map = nextMap;
      const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
      const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      const nextProgram = gl.createProgram();
      if (!nextProgram) throw new Error("Unable to create aviation shader program");
      gl.attachShader(nextProgram, vertex);
      gl.attachShader(nextProgram, fragment);
      gl.linkProgram(nextProgram);
      if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(nextProgram) ?? "Aviation shader link failed");
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      const nextBuffer = gl.createBuffer();
      if (!nextBuffer) throw new Error("Unable to create aviation vertex buffer");
      program = nextProgram;
      buffer = nextBuffer;
    },
    render(gl) {
      const width = map.getCanvas().clientWidth;
      const height = map.getCanvas().clientHeight;
      if (!width || !height) return;
      const nodes = nodesRef.current.filter((node) => isMapCoordinateVisible(map, node.coordinates));
      const vertices = new Float32Array(nodes.flatMap((node) => {
        const point = map.project(node.coordinates);
        return [point.x / width * 2 - 1, 1 - point.y / height * 2, node.size, -node.heading * Math.PI / 180, ...node.color];
      }));
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      const stride = 7 * Float32Array.BYTES_PER_ELEMENT;
      for (const [name, size, offset] of [["position", 2, 0], ["size", 1, 2], ["angle", 1, 3], ["color", 3, 4]] as const) {
        const location = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, nodes.length);
    },
    onRemove(_map, gl) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

function registerDirectionalRenderer(map: MapLibreMap, id: string, nodesRef: { current: DirectionalRenderNode[] }, glyph: "aircraft" | "satellite" | "vessel") {
  if (!map.getLayer(id)) map.addLayer(createDirectionalRenderer(id, nodesRef, glyph));
}

function createIntelPointRenderer(nodesRef: { current: IntelPointRenderNode[] }): CustomLayerInterface {
  let map: MapLibreMap;
  let program: WebGLProgram;
  let buffer: WebGLBuffer;
  const vertexSource = `#version 300 es
    in vec2 position;
    in float size;
    in float glyph;
    in vec3 color;
    out float v_glyph;
    out vec3 v_color;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
      gl_PointSize = size;
      v_glyph = glyph;
      v_color = color;
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    in float v_glyph;
    in vec3 v_color;
    out vec4 outColor;
    void main() {
      vec2 point = gl_PointCoord * 2.0 - 1.0;
      if (v_glyph > 0.5) {
        if (v_glyph > 1.5) {
          float distance = length(point);
          float bracketVertical = 1.0 - smoothstep(0.035, 0.08, abs(abs(point.x) - 0.56));
          float bracketCaps = 1.0 - smoothstep(0.035, 0.08, abs(abs(point.y) - 0.56));
          float verticals = bracketVertical * (1.0 - step(0.66, abs(point.y)));
          float caps = bracketCaps * step(0.31, abs(point.x)) * (1.0 - step(0.58, abs(point.x)));
          float brackets = max(verticals, caps);
          float centerRing = 1.0 - smoothstep(0.035, 0.07, abs(distance - 0.115));
          float core = 1.0 - smoothstep(0.065, 0.11, distance);
          float halo = (1.0 - smoothstep(0.62, 0.9, distance)) * 0.1;
          float alpha = max(max(max(brackets, centerRing), core), halo);
          if (alpha < 0.02) discard;
          outColor = vec4(v_color * (0.76 + brackets * 0.24 + centerRing * 0.12 + core * 0.18), alpha);
          return;
        }
        point.y = -point.y;
        float halfWidth = 0.56 * pow(max(0.0, (0.90 - point.y) / 1.72), 0.58);
        if (point.y < -0.82 || point.y > 0.90 || abs(point.x) > halfWidth) discard;
        float outerEdge = smoothstep(0.0, 0.08, halfWidth - abs(point.x)) * smoothstep(-0.82, -0.66, point.y) * (1.0 - smoothstep(0.79, 0.90, point.y));
        float innerHalfWidth = 0.25 * pow(max(0.0, (0.50 - point.y) / 1.02), 0.62);
        float innerFlame = point.y > -0.52 && point.y < 0.50 && abs(point.x) < innerHalfWidth
          ? smoothstep(0.0, 0.055, innerHalfWidth - abs(point.x)) * smoothstep(-0.52, -0.36, point.y) * (1.0 - smoothstep(0.38, 0.50, point.y))
          : 0.0;
        vec3 fire = mix(vec3(1.0, 0.12, 0.04), vec3(1.0, 0.55, 0.09), innerFlame);
        outColor = vec4(fire * (0.78 + outerEdge * 0.22), outerEdge);
        return;
      }
      float distance = length(point);
      if (distance > 1.0) discard;
      float halo = smoothstep(1.0, 0.35, distance) * 0.34;
      float core = smoothstep(0.48, 0.20, distance);
      outColor = vec4(v_color * (halo + core), halo + core);
    }`;

  return {
    id: "intel-points-gpu",
    type: "custom",
    renderingMode: "2d",
    onAdd(nextMap, gl) {
      map = nextMap;
      const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
      const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      const nextProgram = gl.createProgram();
      if (!nextProgram) throw new Error("Unable to create intelligence point shader program");
      gl.attachShader(nextProgram, vertex);
      gl.attachShader(nextProgram, fragment);
      gl.linkProgram(nextProgram);
      if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(nextProgram) ?? "Intelligence point shader link failed");
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      const nextBuffer = gl.createBuffer();
      if (!nextBuffer) throw new Error("Unable to create intelligence point vertex buffer");
      program = nextProgram;
      buffer = nextBuffer;
    },
    render(gl) {
      const width = map.getCanvas().clientWidth;
      const height = map.getCanvas().clientHeight;
      if (!width || !height) return;
      const nodes = nodesRef.current.filter((node) => isMapCoordinateVisible(map, node.coordinates));
      const zoomScale = Math.min(2.1, Math.max(0.9, 0.9 + map.getZoom() * 0.15));
      const vertices = new Float32Array(nodes.flatMap((node) => {
        const point = map.project(node.coordinates);
        return [point.x / width * 2 - 1, 1 - point.y / height * 2, Math.min(58, node.size * zoomScale), node.glyph === "fire" ? 1 : node.glyph === "reticle" ? 2 : 0, ...node.color];
      }));
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      const stride = 7 * Float32Array.BYTES_PER_ELEMENT;
      for (const [name, size, offset] of [["position", 2, 0], ["size", 1, 2], ["glyph", 1, 3], ["color", 3, 4]] as const) {
        const location = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, nodes.length);
    },
    onRemove(_map, gl) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

function registerIntelPointRenderer(map: MapLibreMap, nodesRef: { current: IntelPointRenderNode[] }) {
  if (!map.getLayer("intel-points-gpu")) map.addLayer(createIntelPointRenderer(nodesRef));
}

function distanceKm(a: [number, number], b: [number, number]) {
  const radians = (value: number) => value * Math.PI / 180;
  const latDelta = radians(b[1] - a[1]);
  const lngDelta = radians(b[0] - a[0]);
  const haversine = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(3)}°${value >= 0 ? positive : negative}`;
}

function formatScale(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K KM`;
  if (value >= 100) return `${Math.round(value)} KM`;
  return `${Math.max(1, Math.round(value))} KM`;
}

function isEntityEnabled(entity: Entity, detailState: Partial<Record<Domain, string[]>>) {
  const selected = detailState[entity.domain] ?? [];
    return selected.some((detailId) => (layerDetails[entity.domain] ?? []).find((detail) => detail.id === detailId)?.match(entity));
}

type MaplibreReactSpikeProps = {
  onFeedStatusChange?: (status: FeedStatus) => void;
  onSearchCorpusChange?: (corpus: WorkspaceSearchCorpus) => void;
  onMapSettingsStateChange?: (state: WorkspaceMapSettingsState) => void;
  onWorkspaceToolStateChange?: (state: WorkspaceToolState) => void;
  onOpenSignalsWorkspace?: () => void;
  mapSettingsRequest?: WorkspaceMapSettingsRequest | null;
  searchSelection?: WorkspaceSearchSelection | null;
  workspaceToolRequest?: WorkspaceToolRequest | null;
};

export function MaplibreReactSpike({ mapSettingsRequest, onFeedStatusChange, onMapSettingsStateChange, onOpenSignalsWorkspace, onSearchCorpusChange, onWorkspaceToolStateChange, searchSelection, workspaceToolRequest }: MaplibreReactSpikeProps = {}) {
  const [snapshot, setSnapshot] = useState<IntelligenceSnapshot>(emptySnapshot);
  const [error, setError] = useState<string | null>(null);
  const [projectionMode, setProjectionMode] = useState<"globe" | "flat">("globe");
  const [baseMode, setBaseMode] = useState<"map" | "carto" | "satellite">("map");
  const cartoApiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  const cartoEnabled = Boolean(cartoApiKey);
  const [cartoStyle, setCartoStyle] = useState<StyleSpecification | null>(null);
  const cartoLoadingRef = useRef(false);
  useEffect(() => {
    if (!cartoEnabled && baseMode === "carto") setBaseMode("map");
  }, [baseMode, cartoEnabled]);
  const [selectedAircraft, setSelectedAircraft] = useState<Entity | null>(null);
  const [selectedIntelPoint, setSelectedIntelPoint] = useState<Entity | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [signalPanelOffset, setSignalPanelOffset] = useState({ x: 0, y: 0 });
  const [signalPanelDragging, setSignalPanelDragging] = useState(false);
  const [graphEntity, setGraphEntity] = useState<Entity | null>(null);
  const [layerOpen, setLayerOpen] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<Domain>("aviation");
  const [detailState, setDetailState] = useState<Record<string, string[]>>(defaultDetailState);
  const [utilityTool, setUtilityTool] = useState<"home" | "actions">("home");
  const [mapSettings, setMapSettings] = useState<MapSettings>(defaultMapSettings);
  const [mapSettingsReady, setMapSettingsReady] = useState(false);
  const [agentCommand, setAgentCommand] = useState<string | null>(null);
  const [agentReferences, setAgentReferences] = useState<ChatReference[]>([]);
  const [deterministicAction, setDeterministicAction] = useState<DeterministicAction | null>(null);
  const [workspaceToolAnchorX, setWorkspaceToolAnchorX] = useState(0);
  const [hud, setHud] = useState<SpikeHudState>({ zoom: 4, center: [18, 34], cursor: null, scaleKm: 0 });
  const [providerRequest, setProviderRequest] = useState<ProviderRequest | null>(null);
  const mapRef = useRef<MapRef>(null);
  const signalPanelRef = useRef<HTMLDivElement>(null);
  const signalPanelDragRef = useRef<SignalPanelDragState | null>(null);
  const liveMapRef = useRef<MapLibreMap | null>(null);
  const aircraftNodesRef = useRef<DirectionalRenderNode[]>([]);
  const maritimeNodesRef = useRef<DirectionalRenderNode[]>([]);
  const satelliteNodesRef = useRef<DirectionalRenderNode[]>([]);
  const intelPointNodesRef = useRef<IntelPointRenderNode[]>([]);
  const locationName = useMapLocation(hud.center);
  const entities = useMemo(() => observationsToEntities(snapshot.observations), [snapshot.observations]);
  const signals = useMemo(() => observationsToSignals(snapshot.observations).sort((left, right) => right.observedAt.localeCompare(left.observedAt)), [snapshot.observations]);
  useEffect(() => onSearchCorpusChange?.({ signals, entities }), [entities, onSearchCorpusChange, signals]);
  useEffect(() => onWorkspaceToolStateChange?.({ chatOpen: Boolean(agentCommand), actionsOpen: utilityTool === "actions" && !agentCommand && !deterministicAction }), [agentCommand, deterministicAction, onWorkspaceToolStateChange, utilityTool]);
  useEffect(() => {
    if (!workspaceToolRequest) return;
    setWorkspaceToolAnchorX(workspaceToolRequest.anchorX);
    if (workspaceToolRequest.kind === "chat") {
      setDeterministicAction(null);
      setUtilityTool("home");
      if (workspaceToolRequest.references) setAgentReferences(workspaceToolRequest.references);
      setAgentCommand((current) => workspaceToolRequest.prompt ? workspaceToolRequest.prompt : current ? null : "Open the analyst chat");
    } else if (agentCommand || deterministicAction || utilityTool === "actions") {
      setAgentCommand(null);
      setDeterministicAction(null);
      setUtilityTool("home");
    } else {
      setUtilityTool("actions");
    }
    // Each navbar click carries a unique token; the current tool state determines
    // whether that explicit request opens or closes its panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceToolRequest?.token]);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ settings?: unknown }> : Promise.reject(new Error("settings read failed")))
      .then((payload) => {
        if (cancelled) return;
        const next = normalizeMapSettings(payload.settings);
        setMapSettings(next);
        setSignalQueueOpen(next.signalPanelEnabled);
        setMapSettingsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setMapSettings(defaultMapSettings);
        setSignalQueueOpen(defaultMapSettings.signalPanelEnabled);
        setMapSettingsReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapSettingsReady) return;
    const controller = new AbortController();
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: mapSettings }),
      signal: controller.signal,
    }).catch(() => { /* Keep the optimistic UI state; the next read will retry the persisted value. */ });
    return () => controller.abort();
  }, [mapSettings, mapSettingsReady]);

  const updateMapSettings = (change: Partial<MapSettings>) => {
    setMapSettings((current) => ({ ...current, ...change }));
    if (change.signalPanelEnabled !== undefined) {
      setSignalQueueOpen(change.signalPanelEnabled);
      if (!change.signalPanelEnabled) setSelectedSignal(null);
    }
  };
  useEffect(() => onMapSettingsStateChange?.({ settings: mapSettings, ready: mapSettingsReady }), [mapSettings, mapSettingsReady, onMapSettingsStateChange]);
  useEffect(() => {
    if (mapSettingsRequest) updateMapSettings(mapSettingsRequest.change);
    // Each workspace edit carries a unique token; the updater uses the current
    // settings state without making it a repeat trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSettingsRequest?.token]);
  const displayedEntities = entities;
  const activeSpikeDomains = useMemo(() => spikeDomains.filter((domain) => (detailState[domain] ?? []).length > 0), [detailState]);
  // Lanes are a static navigational reference, not a live maritime provider result.
  // Keep them on while vessel/port entities retain their opt-in default.
  const shippingLanesVisible = true;
  const aircraftNodes = useMemo(() => toAircraftNodes(displayedEntities.filter((entity) => entity.domain === "aviation" && isEntityEnabled(entity, detailState))), [detailState, displayedEntities]);
  const maritimeNodes = useMemo(() => toMaritimeNodes(displayedEntities.filter((entity) => entity.domain === "maritime" && isEntityEnabled(entity, detailState))), [detailState, displayedEntities]);
  const satelliteNodes = useMemo(() => toSatelliteNodes(displayedEntities.filter((entity) => entity.domain === "space" && isEntityEnabled(entity, detailState))), [detailState, displayedEntities]);
  const maritimePortNodes = useMemo(() => displayedEntities.filter((entity) => entity.domain === "maritime" && entity.properties?.kind !== "vessel" && isEntityEnabled(entity, detailState)), [detailState, displayedEntities]);
  const visibleMaritimePortNodes = useMemo(() => projectionMode === "globe"
    ? maritimePortNodes.filter((port) => isOnFrontGlobeHemisphere(hud.center, [port.location.coordinates.lng, port.location.coordinates.lat]))
    : maritimePortNodes, [hud.center, maritimePortNodes, projectionMode]);
  const intelPointNodes = useMemo(() => toIntelPointNodes(displayedEntities.filter((entity) => isEntityEnabled(entity, detailState))), [detailState, displayedEntities]);
  const loadingLayers = activeSpikeDomains.filter((domain) => !snapshot.snapshots.some((item) => item.domain === domain));
  const statusText = getFeedStatus(snapshot, { loading: !snapshot.fetchedAt, error });
  useEffect(() => {
    onFeedStatusChange?.(statusText);
  }, [onFeedStatusChange, statusText]);
  const liveSourceCount = snapshot.snapshots.filter((item) => item.status === "live").length;
  const providerFailures = snapshot.snapshots.flatMap((item) => {
    if (item.error) return item.error.split("; ").map((detail) => {
      const match = detail.match(/^([^:]+):\s*(.+)$/);
      return match ? { provider: match[1], detail: match[2] } : { provider: item.source.name, detail };
    });
    if (["degraded", "error", "unavailable", "key_required"].includes(item.status)) return [{ provider: item.source.name, detail: item.status.replace(/_/g, " ") }];
    return [];
  });
  const mapStyle = useMemo<StyleSpecification>(() => {
    if (baseMode === "carto" && cartoStyle) return cartoStyle;
    return {
      ...darkStyle,
      layers: darkStyle.layers.map((layer) => {
        if (layer.id === "satellite") return { ...layer, layout: { ...(layer.layout ?? {}), visibility: baseMode === "satellite" ? "visible" : "none" } };
        return { ...layer, layout: { ...(layer.layout ?? {}), visibility: baseMode === "map" ? "visible" : "none" } };
      }),
    };
  }, [baseMode, cartoStyle]);

  const setProjection = (nextProjection: "globe" | "flat") => {
    setProjectionMode(nextProjection);
    requestAnimationFrame(() => {
      mapRef.current?.easeTo({
        pitch: nextProjection === "globe" ? 48 : 0,
        bearing: nextProjection === "globe" ? -12 : 0,
        duration: 850,
        essential: true,
      });
    });
  };

  const setBase = (nextBase: "map" | "carto" | "satellite") => {
    if (nextBase === baseMode) return;
    if (nextBase === "carto") {
      if (!cartoApiKey || cartoLoadingRef.current) return;
      if (cartoStyle) {
        setBaseMode("carto");
        return;
      }
      cartoLoadingRef.current = true;
      void import("@/src/lib/map/carto-style")
        .then(({ createCartoDarkRasterStyle }) => {
          setCartoStyle(createCartoDarkRasterStyle(cartoApiKey));
          setBaseMode("carto");
        })
        .finally(() => {
          cartoLoadingRef.current = false;
        });
      return;
    }
    setBaseMode(nextBase);
  };

  const toggleDetail = (domain: Domain, detailId: string) => {
    setDetailState((current) => {
      const selected = current[domain] ?? [];
      const next = detailId === "all"
        ? (selected.includes("all") ? [] : ["all"])
        : selected.includes(detailId)
          ? selected.filter((id) => id !== detailId)
          : [...selected.filter((id) => id !== "all"), detailId];
      return { ...current, [domain]: next };
    });
  };

  const toggleAllLayers = () => {
    setDetailState((current) => {
      const allActive = spikeDomains.every((domain) => (current[domain] ?? []).length > 0);
      return Object.fromEntries(spikeDomains.map((domain) => [domain, allActive ? [] : ["all"]]));
    });
  };

  const syncHud = (map: MapLibreMap, cursor?: [number, number] | null) => {
    const center = map.getCenter();
    const width = map.getContainer().clientWidth;
    const height = map.getContainer().clientHeight;
    const sampleWidth = Math.min(160, Math.max(80, width * 0.18));
    const y = Math.max(1, height / 2);
    const left = map.unproject([Math.max(0, width / 2 - sampleWidth / 2), y]);
    const right = map.unproject([Math.min(width, width / 2 + sampleWidth / 2), y]);
    setHud((current) => ({ ...current, zoom: map.getZoom(), center: [center.lng, center.lat], cursor: cursor === undefined ? current.cursor : cursor, scaleKm: distanceKm([left.lng, left.lat], [right.lng, right.lat]) }));
  };

  const focusEntity = (entity: Entity) => {
    setSelectedSignal(null);
    setDetailState((current) => (current[entity.domain] ?? []).length > 0 ? current : { ...current, [entity.domain]: ["all"] });
    mapRef.current?.flyTo({ center: [entity.location.coordinates.lng, entity.location.coordinates.lat], zoom: Math.max(6, mapRef.current.getZoom()), duration: 700, essential: true });
    if (entity.domain === "aviation") {
      setSelectedIntelPoint(null);
      setSelectedAircraft(entity);
    } else {
      setSelectedAircraft(null);
      setSelectedIntelPoint(entity);
    }
  };

  const focusPlace = (place: GeosearchResult) => {
    setSelectedSignal(null);
    setSelectedAircraft(null);
    setSelectedIntelPoint(null);
    mapRef.current?.flyTo({ center: place.coordinates, zoom: geosearchZoom[place.kind], duration: 850, essential: true });
  };

  const openNodeGraph = (entity: Entity) => {
    setSelectedSignal(null);
    setSelectedAircraft(null);
    setSelectedIntelPoint(null);
    setGraphEntity(entity);
  };

  const openSignal = (signal: Signal) => {
    if (!mapSettingsReady || !mapSettings.signalPanelEnabled) return;
    const coordinates = signal.location?.coordinates;
    const closest = coordinates
      ? entities
        .filter((entity) => entity.domain === signal.domain)
        .map((entity) => ({ entity, distance: Math.hypot(entity.location.coordinates.lat - coordinates.lat, entity.location.coordinates.lng - coordinates.lng) }))
        .sort((left, right) => left.distance - right.distance)[0]
      : undefined;
    if (!closest || closest.distance >= 1.5) {
      setSelectedAircraft(null);
      setSelectedIntelPoint(null);
      setSelectedSignal(signal);
      return;
    }

    const entity = closest.entity;
    focusEntity(entity);
  };

  useEffect(() => {
    if (!searchSelection) return;
    if (searchSelection.kind === "place") focusPlace(searchSelection.value);
    else if (searchSelection.kind === "signal") openSignal(searchSelection.value);
    else focusEntity(searchSelection.value);
    // The token makes each explicit selection unique; the focus helpers use the
    // current map and provider state without turning those into repeat triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSelection?.token]);

  const referenceAccent = (type: string) => layers.find((layer) => layer.id === type)?.color ?? "#56d7ff";
  const attachEntityToAgent = (entity: Entity) => {
    setAgentReferences((current) => current.some((reference) => reference.kind === "entity" && reference.id === entity.id) ? current : [...current, { kind: "entity", id: entity.id, name: entity.name, type: entity.domain, accent: referenceAccent(entity.domain), entity }]);
    setAgentCommand((current) => current ?? "Open analyst chat");
    setUtilityTool("home");
  };
  const attachSignalToAgent = (signal: Signal) => {
    setAgentReferences((current) => current.some((reference) => reference.kind === "signal" && reference.id === signal.id) ? current : [...current, { kind: "signal", id: signal.id, name: signal.name, type: signal.domain, accent: referenceAccent(signal.domain), signal }]);
    setAgentCommand((current) => current ?? "Open analyst chat");
    setUtilityTool("home");
  };
  const focusAgentReference = (reference: ChatReference) => {
    if (reference.kind === "signal" && reference.signal) openSignal(reference.signal);
    else if (reference.entity) focusEntity(reference.entity);
  };

  const handleSignalPanelDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".map-node-sheet-head") || event.target.closest("button")) return;
    const panel = signalPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    signalPanelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: signalPanelOffset.x,
      baseY: signalPanelOffset.y,
      minX: 8 - rect.left,
      maxX: window.innerWidth - 8 - rect.right,
      minY: 8 - rect.top,
      maxY: window.innerHeight - 8 - rect.bottom,
    };
    setSignalPanelDragging(true);
    event.preventDefault();
  };

  useEffect(() => {
    setSignalPanelOffset({ x: 0, y: 0 });
    signalPanelDragRef.current = null;
    setSignalPanelDragging(false);
  }, [selectedSignal?.id]);

  useEffect(() => {
    if (!signalPanelDragging) return;
    const handleDragMove = (event: globalThis.PointerEvent) => {
      const drag = signalPanelDragRef.current;
      if (!drag) return;
      const deltaX = Math.min(Math.max(event.clientX - drag.startX, drag.minX), drag.maxX);
      const deltaY = Math.min(Math.max(event.clientY - drag.startY, drag.minY), drag.maxY);
      setSignalPanelOffset({ x: drag.baseX + deltaX, y: drag.baseY + deltaY });
    };
    const handleDragEnd = () => {
      signalPanelDragRef.current = null;
      setSignalPanelDragging(false);
    };
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
    window.addEventListener("pointercancel", handleDragEnd);
    return () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragEnd);
    };
  }, [signalPanelDragging]);

  useEffect(() => {
    const viewport = providerRequest?.viewport;
    if (!viewport) return;
    let cancelled = false;
    const controller = new AbortController();
    let settledProviders = 0;
    let successfulProviders = 0;
    const activeProviders = providerRoutes.filter((provider) => activeSpikeDomains.includes(provider.domain));
    const providerCount = activeProviders.length;
    setSnapshot((current) => {
      const snapshots = current.snapshots.filter((item) => activeSpikeDomains.includes(item.domain));
      return { ...current, viewport, snapshots, observations: snapshots.flatMap((item) => item.observations) };
    });
    if (!providerCount) return () => controller.abort();
    const merge = (next: Pick<IntelligenceSnapshot, "snapshots" | "observations">) => {
      if (cancelled) return;
      settledProviders += 1;
      successfulProviders += 1;
      setSnapshot((current) => mergeSnapshot(current, next, viewport));
      setError(null);
    };
    const fail = (domain: Domain, providerId: string, cause: unknown) => {
      if (cancelled) return;
      settledProviders += 1;
      setSnapshot((current) => mergeSnapshot(current, { snapshots: [failedProviderSnapshot(domain, providerId, cause)], observations: [] }, viewport));
      if (settledProviders === providerCount && successfulProviders === 0) setError("All map providers failed");
    };

    const loadProvider = (domain: Domain, providerId: string, url: string) => {
      const params = new URLSearchParams({
        west: String(viewport.west),
        south: String(viewport.south),
        east: String(viewport.east),
        north: String(viewport.north),
        zoom: String(providerRequest.zoom ?? 0),
      });
      void fetch(`${url}?${params.toString()}`, { cache: "no-store", signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error(`${domain} provider returned ${response.status}`); return response.json() as Promise<CanonicalProviderSnapshot>; })
        .then((provider) => merge({ snapshots: [provider], observations: provider.observations ?? [] }))
        .catch((cause) => {
          if (controller.signal.aborted) return;
          fail(domain, providerId, cause);
        });
    };

    for (const provider of activeProviders) loadProvider(provider.domain, provider.providerId, provider.url);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeSpikeDomains, providerRequest]);

  useEffect(() => {
    aircraftNodesRef.current = aircraftNodes;
    maritimeNodesRef.current = maritimeNodes;
    satelliteNodesRef.current = satelliteNodes;
    intelPointNodesRef.current = intelPointNodes;
    liveMapRef.current?.triggerRepaint();
  }, [aircraftNodes, maritimeNodes, satelliteNodes, intelPointNodes]);

  useEffect(() => {
    const map = liveMapRef.current;
    if (!map) return;
    const visibility = shippingLanesVisible ? "visible" : "none";
    for (const layerId of ["shipping-lanes-glow", "shipping-lanes-core"]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }, [shippingLanesVisible]);

  return <main className="maplibre-react-spike" style={{ "--workspace-tool-anchor-x": `${workspaceToolAnchorX}px` } as CSSProperties}>
    <Map
      key={baseMode}
      ref={mapRef}
      initialViewState={{ longitude: 18, latitude: 34, zoom: 4 }}
      mapStyle={mapStyle}
      attributionControl={false}
      projection={projectionMode === "globe" ? "globe" : "mercator"}
      maxPitch={70}
      onLoad={(event) => {
        liveMapRef.current = event.target;
        if (!event.target.getSource("shipping-lanes")) {
          event.target.addSource("shipping-lanes", { type: "geojson", data: shippingLanesGeoJson });
        }
        if (!event.target.getLayer("shipping-lanes-glow")) {
          event.target.addLayer({
            id: "shipping-lanes-glow",
            type: "line",
            source: "shipping-lanes",
            layout: { "line-cap": "round", "line-join": "round", visibility: shippingLanesVisible ? "visible" : "none" },
            paint: {
              "line-color": "#61e1c9",
              "line-width": ["interpolate", ["linear"], ["zoom"], 1, 2.4, 4, 4.8, 8, 8],
              "line-opacity": 0.19,
              "line-blur": 3.2,
            },
          });
        }
        if (!event.target.getLayer("shipping-lanes-core")) {
          event.target.addLayer({
            id: "shipping-lanes-core",
            type: "line",
            source: "shipping-lanes",
            layout: { "line-cap": "round", "line-join": "round", visibility: shippingLanesVisible ? "visible" : "none" },
            paint: {
              "line-color": "#67e6ce",
              "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 4, 1.35, 8, 2.2],
              "line-opacity": 0.64,
            },
          });
        }
        registerDirectionalRenderer(event.target, "aviation-nodes-gpu", aircraftNodesRef, "aircraft");
        registerDirectionalRenderer(event.target, "maritime-vessels-gpu", maritimeNodesRef, "vessel");
        registerDirectionalRenderer(event.target, "space-nodes-gpu", satelliteNodesRef, "satellite");
        registerIntelPointRenderer(event.target, intelPointNodesRef);
        event.target.triggerRepaint();
        requestAnimationFrame(() => {
          syncHud(event.target);
          setProviderRequest({ viewport: viewportForMap(event.target), zoom: event.target.getZoom() });
        });
      }}
      onMove={(event) => syncHud(event.target)}
      onMoveEnd={(event) => setProviderRequest({ viewport: viewportForMap(event.target), zoom: event.target.getZoom() })}
      onMouseMove={(event) => syncHud(event.target, [event.lngLat.lng, event.lngLat.lat])}
      onMouseOut={(event) => syncHud(event.target, null)}
      onClick={(event) => {
        const aircraft = aircraftNodesRef.current.find((item) => {
          if (!isMapCoordinateVisible(event.target, item.coordinates)) return false;
          const point = event.target.project(item.coordinates);
          return Math.hypot(point.x - event.point.x, point.y - event.point.y) <= item.size / 2 + 8;
        });
        if (aircraft) {
          setSelectedIntelPoint(null);
          setSelectedAircraft(aircraft.entity);
          return;
        }
        const maritimeVessel = maritimeNodesRef.current.find((item) => {
          if (!isMapCoordinateVisible(event.target, item.coordinates)) return false;
          const point = event.target.project(item.coordinates);
          return Math.hypot(point.x - event.point.x, point.y - event.point.y) <= item.size / 2 + 8;
        });
        if (maritimeVessel) {
          setSelectedAircraft(null);
          setSelectedIntelPoint(maritimeVessel.entity);
          return;
        }
        const satellite = satelliteNodesRef.current.find((item) => {
          if (!isMapCoordinateVisible(event.target, item.coordinates)) return false;
          const point = event.target.project(item.coordinates);
          return Math.hypot(point.x - event.point.x, point.y - event.point.y) <= item.size / 2 + 8;
        });
        if (satellite) {
          setSelectedAircraft(null);
          setSelectedIntelPoint(satellite.entity);
          return;
        }
        const intelPoint = intelPointNodesRef.current.find((item) => {
          if (!isMapCoordinateVisible(event.target, item.coordinates)) return false;
          const point = event.target.project(item.coordinates);
          return Math.hypot(point.x - event.point.x, point.y - event.point.y) <= item.size / 2 + 8;
        });
        if (intelPoint) {
          setSelectedAircraft(null);
          setSelectedIntelPoint(intelPoint.entity);
          return;
        }
        setSelectedAircraft(null);
        setSelectedIntelPoint(null);
      }}
    >
      {visibleMaritimePortNodes.map((port) => <Marker key={port.id} longitude={port.location.coordinates.lng} latitude={port.location.coordinates.lat} anchor="center" onClick={(event) => { event.originalEvent.stopPropagation(); setSelectedAircraft(null); setSelectedIntelPoint(port); }}>
        <span className="maritime-port-marker" title={port.name} aria-label={`${port.name} port`}><Anchor size={15} weight="bold" /></span>
      </Marker>)}
      {selectedAircraft && <Popup longitude={selectedAircraft.location.coordinates.lng} latitude={selectedAircraft.location.coordinates.lat} offset={18} closeButton={false} closeOnClick={false} onClose={() => setSelectedAircraft(null)}>
        <MapNodeSheet entity={selectedAircraft} onClose={() => setSelectedAircraft(null)} onAgent={attachEntityToAgent} onGraph={openNodeGraph} />
      </Popup>}
      {selectedIntelPoint && <Popup longitude={selectedIntelPoint.location.coordinates.lng} latitude={selectedIntelPoint.location.coordinates.lat} offset={16} closeButton={false} closeOnClick={false} onClose={() => setSelectedIntelPoint(null)}>
        <MapNodeSheet entity={selectedIntelPoint} onClose={() => setSelectedIntelPoint(null)} onAgent={attachEntityToAgent} onGraph={openNodeGraph} />
      </Popup>}
      <NavigationControl position="bottom-right" showCompass visualizePitch />
    </Map>
    {snapshot.fetchedAt && <div className="map-view-controls" role="group" aria-label="Map view controls">
      <button type="button" className={projectionMode === "globe" ? "active" : ""} onClick={() => setProjection("globe")} aria-pressed={projectionMode === "globe"} aria-label="3D globe view">3D</button>
      <button type="button" className={projectionMode === "flat" ? "active" : ""} onClick={() => setProjection("flat")} aria-pressed={projectionMode === "flat"} aria-label="2D flat map view">2D</button>
      <span className="map-control-divider" aria-hidden="true" />
      <button type="button" className={baseMode === "map" ? "active" : ""} onClick={() => setBase("map")} aria-pressed={baseMode === "map"} aria-label="Esri dark gray map base">MAP</button>
      {cartoEnabled && <button type="button" className={baseMode === "carto" ? "active" : ""} onClick={() => setBase("carto")} aria-pressed={baseMode === "carto"} aria-label="Carto dark map base">CARTO</button>}
      <button type="button" className={baseMode === "satellite" ? "active" : ""} onClick={() => setBase("satellite")} aria-pressed={baseMode === "satellite"} aria-label="Satellite imagery base">SAT</button>
    </div>}
    {snapshot.fetchedAt && <LayerRail activeLayers={activeSpikeDomains} loadingLayers={loadingLayers} detailState={detailState} layersData={layers} snapshot={snapshot} selectedLayer={selectedLayer} open={layerOpen} onSelect={(domain) => { setSelectedLayer(domain); setLayerOpen(true); }} onToggleLayer={() => undefined} onToggleAll={toggleAllLayers} onToggleDetail={toggleDetail} onClose={() => setLayerOpen(false)} />}
    {snapshot.fetchedAt && mapSettingsReady && mapSettings.signalPanelEnabled && !selectedSignal && <div className="maplibre-spike-signal-queue"><IncomingSignalQueue signals={signals} status={statusText} onOpenSignal={openSignal} onOpenEntity={focusEntity} onViewAll={onOpenSignalsWorkspace} /></div>}
    {snapshot.fetchedAt && mapSettingsReady && mapSettings.signalPanelEnabled && selectedSignal && <div ref={signalPanelRef} className={`spike-signal-node-sheet${signalPanelDragging ? " is-dragging" : ""}`} style={{ "--signal-drag-x": `${signalPanelOffset.x}px`, "--signal-drag-y": `${signalPanelOffset.y}px` } as CSSProperties} onPointerDown={handleSignalPanelDragStart} data-dragging={signalPanelDragging ? "true" : undefined}><MapNodeSheet entity={signalNode(selectedSignal)} onClose={() => setSelectedSignal(null)} onAgent={() => attachSignalToAgent(selectedSignal)} facts={[]} observedLabel={selectedSignal.observedAt ? `${selectedSignal.observedAt.slice(11, 19)}Z` : "—"} media={selectedSignal.imageUrl ? { kind: "jpg", url: selectedSignal.imageUrl } : undefined} showDetail showMediaSourcePicker={false} sourceActionLabel="VIEW REPORT" /></div>}
    {snapshot.fetchedAt && graphEntity && <NodeGraphSheet entity={graphEntity} observations={snapshot.observations} onClose={() => setGraphEntity(null)} />}
    {snapshot.fetchedAt && <MapHud className="map-facts" facts={[
      { label: "ZOOM", value: hud.zoom.toFixed(1) },
      { label: "LOCATION", value: locationName, tone: "green" },
      { label: "SCALE", value: formatScale(hud.scaleKm), tone: "amber" },
      { label: "CURSOR LON LAT", value: hud.cursor ? `${formatCoordinate(hud.cursor[1], "N", "S")} ${formatCoordinate(hud.cursor[0], "E", "W")}` : "—" },
    ]} />}
    {typeof document !== "undefined" && snapshot.fetchedAt && createPortal(<div className="workspace-tool-layer" style={{ "--workspace-tool-anchor-x": `${workspaceToolAnchorX}px` } as CSSProperties}>
      {utilityTool === "actions" && !agentCommand && !deterministicAction && <aside className="spike-actions-overlay" aria-label="Actions"><button type="button" className="spike-actions-close" onClick={() => setUtilityTool("home")} aria-label="Close actions"><X size={15} /></button><ActionDeck onAction={(action) => { setDeterministicAction(action); setUtilityTool("home"); }} onAgent={() => setAgentCommand("Triage the highest risk incoming signals now")} onOverview={() => { setAgentCommand("Open the current map overview"); setUtilityTool("home"); }} /></aside>}
      {deterministicAction && <DeterministicActionSheet variant="map" action={deterministicAction} onClose={() => { setDeterministicAction(null); setUtilityTool("home"); }} />}
      {agentCommand && <AgentSheet variant="map" initialCommand={agentCommand} entityIds={entities.slice(0, 20).map((entity) => entity.id)} references={agentReferences} onRemoveReference={(referenceId) => setAgentReferences((current) => current.filter((reference) => reference.id !== referenceId))} onFocusReference={focusAgentReference} context={{ fetchedAt: snapshot.fetchedAt, viewport: snapshot.viewport, observations: snapshot.observations, sourceStatuses: snapshot.snapshots.map((item) => ({ sourceId: item.source.id, status: item.status, error: item.error })) }} onClose={() => { setAgentCommand(null); setUtilityTool("home"); }} />}
    </div>, document.body)}
    {!snapshot.fetchedAt && <div className="maplibre-react-spike-loader">{error ?? "LOADING..."}</div>}
  </main>;
}
