// Builds docs/map-mask.geojson, two features clipped to the region:
//   role "mask": the land of every country around East Asia, which the
//                YouTube map paints over in flat grey;
//   role "keep": East Asia itself, used to drop place names outside it.
//
//   node tools/build-map-mask.mjs
//
// Borders come from Natural Earth (public domain), 1:50m countries.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCE =
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";

// Countries that stay visible (ISO 3166-1 alpha-3, Natural Earth ADM0_A3).
const EAST_ASIA = new Set(["CHN", "HKG", "MAC", "TWN", "JPN", "KOR", "PRK", "MNG"]);

// Clip box: comfortably larger than the map's locked view, so the clipped
// edges are never on screen.
const CLIP = { west: 55, south: 0, east: 165, north: 65 };

const PRECISION = 1e3; // 3 decimals, about 100 m

function clipRing(ring) {
    // Sutherland–Hodgman against each side of the box in turn.
    const edges = [
        (p) => p[0] >= CLIP.west, (a, b) => cross(a, b, 0, CLIP.west),
        (p) => p[0] <= CLIP.east, (a, b) => cross(a, b, 0, CLIP.east),
        (p) => p[1] >= CLIP.south, (a, b) => cross(a, b, 1, CLIP.south),
        (p) => p[1] <= CLIP.north, (a, b) => cross(a, b, 1, CLIP.north),
    ];
    let points = ring.slice(0, -1);
    for (let i = 0; i < edges.length; i += 2) {
        const inside = edges[i];
        const intersect = edges[i + 1];
        const result = [];
        for (let j = 0; j < points.length; j++) {
            const current = points[j];
            const previous = points[(j + points.length - 1) % points.length];
            if (inside(current)) {
                if (!inside(previous)) result.push(intersect(previous, current));
                result.push(current);
            } else if (inside(previous)) {
                result.push(intersect(previous, current));
            }
        }
        points = result;
        if (points.length === 0) return null;
    }
    const rounded = [];
    for (const [x, y] of points) {
        const p = [Math.round(x * PRECISION) / PRECISION, Math.round(y * PRECISION) / PRECISION];
        const last = rounded[rounded.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) rounded.push(p);
    }
    if (rounded.length < 3) return null;
    rounded.push(rounded[0]);
    return rounded;
}

function cross(a, b, axis, value) {
    const t = (value - a[axis]) / (b[axis] - a[axis]);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

const world = await (await fetch(SOURCE)).json();
const maskPolygons = [];
const keepPolygons = [];
const masked = [];

for (const feature of world.features) {
    const code = feature.properties.ADM0_A3;
    const target = EAST_ASIA.has(code) ? keepPolygons : maskPolygons;
    const geometry = feature.geometry;
    const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    let used = false;
    for (const polygon of parts) {
        const rings = polygon.map(clipRing);
        if (!rings[0]) continue;
        target.push(rings.filter(Boolean));
        used = true;
    }
    if (used && target === maskPolygons) masked.push(code);
}

const multi = (role, coordinates) => ({
    type: "Feature",
    properties: { role },
    geometry: { type: "MultiPolygon", coordinates },
});

const mask = {
    type: "FeatureCollection",
    features: [multi("mask", maskPolygons), multi("keep", keepPolygons)],
};

const out = resolve(import.meta.dirname, "../docs/map-mask.geojson");
await writeFile(out, JSON.stringify(mask));
console.log("Masked:", masked.join(" "));
console.log("Wrote", out);
