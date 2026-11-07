// East Street Labs — YouTube map
//
// Every video is one entry in videos.json. To add a video, append:
//
//     {
//         "youtubeId": "abcDEF12345",          // the part after ?v= in the URL
//         "title": "Night market food in Taipei",
//         "place": "Taipei, Taiwan",           // shown under the title
//         "lat": 25.0478,                      // right-click the spot in Google Maps
//         "lng": 121.5170                      // and click the numbers to copy them
//     }
//
// Entries with "example": true are placeholders and have no real video.
//
// Nearby videos are clustered: zoomed out, they merge into a numbered circle
// that splits apart as you zoom in. Videos that share the exact same spot
// (say, several from "Tokyo") never split, so clicking them lists them all.
//
// Nothing here loads until the YouTube page is opened: the map library, the
// map tiles (OpenFreeMap) and the thumbnails (YouTube) are only requested
// then, so every other page keeps making no third-party requests at all.

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const LIBRARY = "./vendor/maplibre-gl/maplibre-gl.mjs";
const LIBRARY_CSS = "vendor/maplibre-gl/maplibre-gl.css";

// China, Mongolia, the Koreas, Japan and Taiwan, with a little margin.
const EAST_ASIA = [[73, 17], [146, 54]];

// The map can never be panned or zoomed out past this box: the rest of the
// world is simply out of reach.
const LOCKED_TO = [[71, 15], [149, 55]];

// A box still catches the neighbours (India, Vietnam, Russia…), so their land
// is painted over in one flat colour, without names or roads. Rebuild the
// file with `node tools/build-map-mask.mjs`.
const MASK_URL = "map-mask.geojson";

// The map in the site's own palette (the mountain-blue scale in styles.css).
// Every colour of the map is set here; applyTheme() paints them on.
const THEME = {
    land: "#EEE7AD",           // East Asia: the logo's yellow sky (#EAE198), 20% lighter
    neighbours: "#D9F3F7",     // 100 — the masked countries, same as the page
    sea: "#B0E6EE",            // 200 — oceans, lakes and rivers
    green: "#C8EBDD",          // parks, forest, grass: a pale blue-green
    builtUp: "#F5F1D0",        // towns, schools, hospitals, airports: lighter yellow
    building: "#DDD38A",       // darker yellow
    road: "#FFFFFF",
    roadEdge: "#D6CC80",       // outline of small roads, a deeper yellow
    majorRoadEdge: "#6DD1E1",  // 300 — outline of highways and main roads
    rail: "#A9C3C9",
    border: "#4FB5C9",         // 400 — country borders
    regionBorder: "#B0E6EE",   // 200 — provinces and prefectures
    text: "#182326",           // foreground
    textSoft: "#55656A",       // muted foreground: regions, roads, places
    textWater: "#0F6F85",      // 700
    halo: "#FFFFFF",
    pin: "#F4A48C",            // the logo's cherry-blossom pink
    pinEdge: "#C8674F",        // a deeper shade of the same pink
    pinText: "#6E2A1C",        // cluster numbers: white is too faint on the pink
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const SOURCE = "videos";
const PIN_IMAGE = "video-pin";
const PIN_HEIGHT = 43;          // px at full size
const CLUSTER_RADIUS = 48;      // px: pins closer than this on screen merge
const CLUSTER_MAX_ZOOM = 14;    // past this zoom nothing is clustered any more

let started = false;
let maplibre = null;
let map = null;
let videos = [];
let popup = null;

function isYouTubeRoute() {
    return window.location.hash.replace(/^#\/?/, "") === "youtube";
}

function onRoute() {
    if (!isYouTubeRoute()) {
        return;
    }
    if (!started) {
        started = true;
        start();
    } else if (map) {
        // The section was hidden while away, so the canvas may have the wrong size.
        requestAnimationFrame(() => map.resize());
    }
}

function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = resolve;
        link.onerror = () => reject(new Error("could not load " + href));
        document.head.appendChild(link);
    });
}

async function loadVideos() {
    const response = await fetch("videos.json", { cache: "no-cache" });
    if (!response.ok) {
        throw new Error("videos.json: HTTP " + response.status);
    }
    const list = await response.json();
    return list.filter((video) => {
        const ok = typeof video.lat === "number" && typeof video.lng === "number" && video.title;
        if (!ok) {
            console.warn("videos.json: skipping an entry without title, lat or lng", video);
        }
        return ok;
    });
}

async function start() {
    const status = document.getElementById("video-map-status");

    try {
        const [library, list] = await Promise.all([
            import(LIBRARY),
            loadVideos(),
            loadStylesheet(LIBRARY_CSS),
        ]);
        maplibre = library;
        videos = list;
        buildMap();
        buildList();
        status.hidden = true;
    } catch (err) {
        console.error("YouTube map: " + err.message);
        status.textContent = "The map could not be loaded. Please try again later.";
        status.classList.add("chip-error");
        status.hidden = false;
    }
}

// ============================================================
// Map
// ============================================================

function buildMap() {
    map = new maplibre.Map({
        container: "video-map",
        style: STYLE_URL,
        bounds: EAST_ASIA,
        fitBoundsOptions: { padding: 16 },
        maxBounds: LOCKED_TO,
        renderWorldCopies: false,
        // Like an embedded Google map: page scrolling is not hijacked; zoom
        // with Ctrl/⌘ + scroll, or two fingers on a phone.
        cooperativeGestures: true,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
    });

    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibre.FullscreenControl(), "top-right");

    // "style.load" fires as soon as the style is read, before any tile is
    // drawn, so the map never flashes its original colours first.
    map.once("style.load", async () => {
        // Google's default map is flat; the style's shaded-relief layer makes the
        // zoomed-out view look like a physical atlas instead, so switch it off.
        for (const layer of map.getStyle().layers) {
            if (layer.source === "ne2_shaded") {
                map.setLayoutProperty(layer.id, "visibility", "none");
            }
        }

        try {
            applyTheme();
            await addMask();
            map.addImage(PIN_IMAGE, await pinImage(), { pixelRatio: 2 });
            addVideoLayers();
        } catch (err) {
            console.error("YouTube map: " + err.message);
        }
    });

    map.once("load", () => {
        // Start with the attribution folded into its (i) button, like Google's
        // small credit line, instead of a wide bar over a phone-sized map.
        map.getContainer()
            .querySelector(".maplibregl-ctrl-attrib")
            ?.classList.remove("maplibregl-compact-show");
    });
}

// Repaint the base map (OpenFreeMap's "liberty" style) in THEME's colours.
// Layers are matched by the ids that style uses.
const GREEN = ["park", "landcover_wood", "landcover_grass", "landuse_cemetery", "landuse_pitch", "landuse_track"];
const BUILT_UP = ["landuse_residential", "landuse_hospital", "landuse_school", "aeroway_fill"];
const MAJOR_ROAD = /motorway|trunk|primary|secondary|link/;

function applyTheme() {
    for (const layer of map.getStyle().layers) {
        const id = layer.id;
        const paint = (property, value) => map.setPaintProperty(id, property, value);

        if (id === "background") {
            paint("background-color", THEME.land);
        } else if (id === "water") {
            paint("fill-color", THEME.sea);
        } else if (id.startsWith("waterway") && layer.type === "line") {
            paint("line-color", THEME.sea);
        } else if (GREEN.includes(id)) {
            paint("fill-color", THEME.green);
            paint("fill-opacity", 1);
        } else if (id === "park_outline") {
            paint("line-color", THEME.green);
        } else if (BUILT_UP.includes(id)) {
            paint("fill-color", THEME.builtUp);
            paint("fill-opacity", 1);
        } else if (id === "landcover_sand" || id === "landcover_ice") {
            paint("fill-color", THEME.land);
        } else if (id.startsWith("aeroway") && layer.type === "line") {
            paint("line-color", THEME.road);
        } else if (id === "building") {
            paint("fill-color", THEME.building);
            paint("fill-outline-color", THEME.building);
        } else if (layer["source-layer"] === "transportation" && layer.type === "line") {
            if (id.includes("rail")) {
                paint("line-color", THEME.rail);
            } else if (id.endsWith("_casing")) {
                paint("line-color", MAJOR_ROAD.test(id) ? THEME.majorRoadEdge : THEME.roadEdge);
            } else {
                paint("line-color", THEME.road);
            }
        } else if (id === "boundary_2" || id === "boundary_disputed") {
            paint("line-color", THEME.border);
        } else if (id === "boundary_3") {
            paint("line-color", THEME.regionBorder);
        } else if (layer.type === "symbol" && layer.layout?.["text-field"]) {
            const water = id.startsWith("water");
            const main = /^label_(city|town|village|country)/.test(id);
            paint("text-color", water ? THEME.textWater : main ? THEME.text : THEME.textSoft);
            paint("text-halo-color", THEME.halo);
        }
    }
}

async function addMask() {
    const response = await fetch(MASK_URL);
    if (!response.ok) {
        throw new Error(MASK_URL + ": HTTP " + response.status);
    }
    const data = await response.json();
    const part = (role) => data.features.find((feature) => feature.properties.role === role);

    // Above every layer of the base map, below the pins and clusters.
    map.addSource("mask", { type: "geojson", data: part("mask") });
    map.addLayer({
        id: "mask",
        type: "fill",
        source: "mask",
        paint: { "fill-color": THEME.neighbours, "fill-antialias": false },
    });

    // Place names are wider than their point, so a name just across the
    // border (Kathmandu, Vladivostok…) would stick out over East Asia.
    // Keep only names whose point lies inside East Asia.
    const inside = ["within", part("keep").geometry];
    for (const layer of map.getStyle().layers) {
        if (layer.type === "symbol" && (layer.id.startsWith("label_") || layer.id === "airport")) {
            map.setFilter(layer.id, layer.filter ? ["all", layer.filter, inside] : inside);
        }
    }
}

// The pin is drawn by the map itself (not one HTML element per video), which
// is what lets clustering and thousands of videos stay smooth.
function pinImage() {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 43" width="54" height="86">' +
        '<path d="M13.5 1C6.6 1 1 6.6 1 13.5c0 9.6 12.5 28.5 12.5 28.5S26 23.1 26 13.5C26 6.6 20.4 1 13.5 1z"' +
        ' fill="' + THEME.pin + '" stroke="' + THEME.pinEdge + '" stroke-width="1.5"/>' +
        '<circle cx="13.5" cy="13.5" r="4.6" fill="#FFFFFF"/>' +
        "</svg>";
    const img = new Image(54, 86);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    return img.decode().then(() => img);
}

function toGeoJSON() {
    return {
        type: "FeatureCollection",
        features: videos.map((video, index) => ({
            type: "Feature",
            properties: { index },
            geometry: { type: "Point", coordinates: [video.lng, video.lat] },
        })),
    };
}

// Pins shrink a little when zoomed far out, and are full size from city level.
const PIN_SIZE = ["interpolate", ["linear"], ["zoom"], 3, 0.75, 8, 1];

function pinScale() {
    const zoom = map.getZoom();
    if (zoom <= 3) return 0.75;
    if (zoom >= 8) return 1;
    return 0.75 + (0.25 * (zoom - 3)) / 5;
}

function addVideoLayers() {
    map.addSource(SOURCE, {
        type: "geojson",
        data: toGeoJSON(),
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });

    const isCluster = ["has", "point_count"];
    // Bigger groups get a bigger circle: under 10, 10–49, 50 and up.
    const size = (small, medium, large) => ["step", ["get", "point_count"], small, 10, medium, 50, large];

    map.addLayer({
        id: "cluster-halo",
        type: "circle",
        source: SOURCE,
        filter: isCluster,
        paint: {
            "circle-color": THEME.pin,
            "circle-opacity": 0.35,
            "circle-radius": size(24, 29, 35),
        },
    });

    map.addLayer({
        id: "clusters",
        type: "circle",
        source: SOURCE,
        filter: isCluster,
        paint: {
            "circle-color": THEME.pin,
            "circle-radius": size(17, 21, 26),
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 2,
        },
    });

    map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: SOURCE,
        filter: isCluster,
        layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"],
            "text-size": size(13, 14, 15),
            "text-allow-overlap": true,
            "text-ignore-placement": true,
        },
        paint: { "text-color": THEME.pinText },
    });

    map.addLayer({
        id: "pins",
        type: "symbol",
        source: SOURCE,
        filter: ["!", isCluster],
        layout: {
            "icon-image": PIN_IMAGE,
            "icon-anchor": "bottom",
            "icon-size": PIN_SIZE,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
    });

    map.on("click", "clusters", onClusterClick);
    map.on("click", "pins", onPinClick);

    for (const layer of ["clusters", "pins"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
}

async function onClusterClick(event) {
    const cluster = event.features[0];
    const id = cluster.properties.cluster_id;
    const source = map.getSource(SOURCE);
    const zoom = await source.getClusterExpansionZoom(id);

    if (zoom <= CLUSTER_MAX_ZOOM) {
        // Zoom in exactly far enough for the group to come apart.
        map.easeTo({ center: cluster.geometry.coordinates, zoom });
        return;
    }

    // The videos sit on (nearly) the same spot, so zooming would never split
    // them. List them instead.
    const leaves = await source.getClusterLeaves(id, 1000, 0);
    const indices = leaves.map((leaf) => leaf.properties.index);
    openPopup(indices, cluster.geometry.coordinates, "cluster");
}

function onPinClick(event) {
    const index = event.features[0].properties.index;
    const video = videos[index];

    // Pins at identical coordinates are drawn on top of each other; collect
    // every one of them, not just the top one.
    const here = new Set([index]);
    for (const feature of event.features) {
        const other = videos[feature.properties.index];
        if (other.lat === video.lat && other.lng === video.lng) {
            here.add(feature.properties.index);
        }
    }

    openPopup([...here], [video.lng, video.lat], "pin");
}

function openPopup(indices, lngLat, over) {
    if (popup) {
        popup.remove();
    }

    // Sit just above whatever was clicked: the tip of a pin, or a cluster circle.
    const lift = over === "pin" ? PIN_HEIGHT * pinScale() : 22;

    popup = new maplibre.Popup({
        anchor: "bottom",
        offset: [0, -lift],
        maxWidth: "18rem",
        focusAfterOpen: false,
    });

    const content =
        indices.length === 1
            ? videoContent(videos[indices[0]])
            : stackContent(indices, popup);

    // Removing the popup also removes any playing video with it.
    popup.on("open", () => panIntoView(popup));
    popup.setLngLat(lngLat).setDOMContent(content).addTo(map);
}

// Like a Google info window: if the popup sticks out of the map, or sits
// under the corner controls, slide the map until the whole popup is clear.
// The popup is already positioned when "open" fires, so measure right away.
function panIntoView(popup) {
    const box = popup.getElement().getBoundingClientRect();
    const frame = map.getContainer().getBoundingClientRect();

    // Room for the zoom and fullscreen buttons, but never more than the
    // space a narrow (phone) map actually has to spare beside the popup.
    const marginX = Math.max(8, Math.min(48, (frame.width - box.width) / 2));
    const marginY = Math.max(8, Math.min(48, (frame.height - box.height) / 2));

    let dx = 0;
    let dy = 0;
    if (box.left < frame.left + marginX) dx = box.left - frame.left - marginX;
    else if (box.right > frame.right - marginX) dx = box.right - frame.right + marginX;
    if (box.top < frame.top + marginY) dy = box.top - frame.top - marginY;
    else if (box.bottom > frame.bottom - marginY) dy = box.bottom - frame.bottom + marginY;

    if (dx || dy) {
        map.panBy([dx, dy], { duration: 300 });
    }
}

// ============================================================
// Popup content
// ============================================================

function thumbnailUrl(video) {
    return "https://i.ytimg.com/vi/" + video.youtubeId + "/hqdefault.jpg";
}

function watchUrl(video) {
    return "https://www.youtube.com/watch?v=" + video.youtubeId;
}

function hasVideo(video) {
    return YOUTUBE_ID.test(video.youtubeId || "");
}

function thumbnail(video, placeholderText) {
    const thumb = document.createElement("span");
    thumb.className = "video-item-thumb";
    if (hasVideo(video)) {
        const img = document.createElement("img");
        img.src = thumbnailUrl(video);
        img.alt = "";
        img.loading = "lazy";
        thumb.appendChild(img);
    } else {
        thumb.classList.add("video-placeholder");
        thumb.textContent = placeholderText;
    }
    return thumb;
}

function titleAndPlace(video) {
    const text = document.createElement("span");
    text.className = "video-item-text";

    const title = document.createElement("span");
    title.className = "video-item-title";
    title.textContent = video.title;
    text.appendChild(title);

    if (video.place) {
        const place = document.createElement("span");
        place.className = "video-item-place";
        place.textContent = video.place;
        text.appendChild(place);
    }
    return text;
}

// One video: big thumbnail that turns into the player when pressed.
// `back`, when given, returns to the list of videos at the same spot.
function videoContent(video, back) {
    const root = document.createElement("div");
    root.className = "video-popup";

    const media = document.createElement("div");
    media.className = "video-popup-media";

    if (hasVideo(video)) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "video-popup-play";
        play.setAttribute("aria-label", "Play " + video.title);

        const img = document.createElement("img");
        img.src = thumbnailUrl(video);
        img.alt = "";
        play.appendChild(img);

        const icon = document.createElement("span");
        icon.className = "video-play-icon";
        icon.setAttribute("aria-hidden", "true");
        play.appendChild(icon);

        // The YouTube player (privacy-enhanced domain) loads only on press.
        play.addEventListener("click", () => {
            const frame = document.createElement("iframe");
            frame.src = "https://www.youtube-nocookie.com/embed/" + video.youtubeId + "?autoplay=1&rel=0";
            frame.title = video.title;
            frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
            frame.allowFullscreen = true;
            media.replaceChildren(frame);
        });

        media.appendChild(play);
    } else {
        media.classList.add("video-placeholder");
        media.textContent = "Example — no video yet";
    }
    root.appendChild(media);

    const title = document.createElement("div");
    title.className = "video-popup-title";
    title.textContent = video.title;
    root.appendChild(title);

    if (video.place) {
        const place = document.createElement("div");
        place.className = "video-popup-place";
        place.textContent = video.place;
        root.appendChild(place);
    }

    const links = document.createElement("div");
    links.className = "video-popup-links";

    if (back) {
        const backButton = document.createElement("button");
        backButton.type = "button";
        backButton.className = "video-popup-link";
        backButton.textContent = "← All videos here";
        backButton.addEventListener("click", back);
        links.appendChild(backButton);
    }

    if (hasVideo(video)) {
        const link = document.createElement("a");
        link.className = "video-popup-link";
        link.href = watchUrl(video);
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Watch on YouTube";
        links.appendChild(link);
    }

    if (links.childElementCount) {
        root.appendChild(links);
    }
    return root;
}

// Several videos at one spot: a scrollable list; picking one shows it.
function stackContent(indices, popup) {
    const root = document.createElement("div");
    root.className = "video-popup";

    const head = document.createElement("div");
    head.className = "video-stack-head";
    head.textContent = indices.length + " videos here";
    root.appendChild(head);

    const list = document.createElement("ul");
    list.className = "video-stack";

    for (const index of indices) {
        const video = videos[index];
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "video-stack-item";
        button.appendChild(thumbnail(video, "Example"));
        button.appendChild(titleAndPlace(video));
        button.addEventListener("click", () => {
            popup.setDOMContent(videoContent(video, () => popup.setDOMContent(root)));
            panIntoView(popup);
        });
        item.appendChild(button);
        list.appendChild(item);
    }

    root.appendChild(list);
    return root;
}

// ============================================================
// List under the map
// ============================================================

function buildList() {
    const list = document.getElementById("video-list");
    const empty = document.getElementById("video-empty");

    if (videos.length === 0) {
        empty.hidden = false;
        return;
    }

    videos.forEach((video, index) => {
        const item = document.createElement("li");

        const button = document.createElement("button");
        button.type = "button";
        button.className = "video-item";
        button.appendChild(thumbnail(video, "Example"));
        button.appendChild(titleAndPlace(video));
        button.addEventListener("click", () => showOnMap(index));

        item.appendChild(button);
        list.appendChild(item);
    });

    list.hidden = false;
}

function showOnMap(index) {
    if (!map) {
        return;
    }
    const video = videos[index];

    if (popup) {
        popup.remove();
    }

    document.getElementById("video-map").scrollIntoView({ behavior: "smooth", block: "center" });
    map.flyTo({ center: [video.lng, video.lat], zoom: Math.max(map.getZoom(), 12), essential: true });
    map.once("moveend", () => openPopup([index], [video.lng, video.lat], "pin"));
}

window.addEventListener("hashchange", onRoute);
onRoute();
