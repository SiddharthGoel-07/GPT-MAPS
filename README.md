README.md
# GPT Maps

AI-powered interactive map visualization built as an **MCP Server + MCP App** for Claude Desktop.

GPT Maps allows an LLM to control an interactive MapLibre map through custom MCP tools. Instead of only returning textual geographic information, the model can visualize locations, connect places with paths, and display geographic boundaries directly on the map.

## Features

- 📍 **Markers** — place locations on the map
- 🛣️ **Paths** — connect multiple geographic points
- 🗺️ **Polygons** — render geographic boundaries
- 🌍 **Country-aware camera positioning** — intelligently adjusts the map view based on the countries associated with locations
- 🔎 **Nominatim integration** — resolves geographic boundaries using OpenStreetMap data
- 🧩 **MCP integration** — exposes map operations as tools that an LLM can call
- 🖥️ **Claude Desktop integration** — renders the map inside a sandboxed MCP App
- 📦 **MCPB packaging** — distributable as a Claude Desktop extension
- 🔄 **Scene-based rendering** — represents map state using shared scene objects
- 🛡️ **CSP-aware sandboxing** — supports external MapLibre resources inside the MCP App sandbox

---

## Example

A user can ask:

> Show Delhi, Mumbai and Bangalore and connect them with a path.

The LLM can call the MCP tools to create the required scene:

```text
User
  ↓
Claude
  ↓
MCP Tool Calls
  ├── createMarker
  ├── createMarker
  ├── createMarker
  └── createPath
        ↓
     Scene
        ↓
   SceneSerializer
        ↓
   MCP Resource
        ↓
   React + MapLibre
        ↓
 Interactive Map

The result is rendered directly inside the Claude Desktop interface.

Architecture

GPT Maps is structured as a TypeScript monorepo with separate shared, server, and web packages.

GPT Maps
│
├── packages/
│   │
│   ├── shared/
│   │   ├── objects/
│   │   │   ├── Marker
│   │   │   ├── Path
│   │   │   └── Polygon
│   │   │
│   │   └── scene/
│   │       └── SceneBuilder
│   │
│   ├── server/
│   │   ├── tools/
│   │   │   ├── createMarker
│   │   │   ├── createPath
│   │   │   ├── createPolygon
│   │   │   └── renderScene
│   │   │
│   │   ├── services/
│   │   │   └── BoundaryService
│   │   │
│   │   └── SceneSerializer
│   │
│   └── web/
│       ├── renderer/
│       │   └── MapRenderer
│       ├── SceneDeserializer
│       └── MCP App
│
└── mcpb/
    └── Claude Desktop package
Data flow
LLM
 │
 │ MCP tool calls
 ▼
MCP Server
 │
 ├── createMarker
 ├── createPath
 ├── createPolygon
 └── renderScene
 │
 ▼
Scene Model
 │
 ▼
SceneSerializer
 │
 ▼
MCP Resource
 │
 ▼
React MCP App
 │
 ▼
MapLibre GL
 │
 ▼
Interactive Map
MCP Tools
createMarker

Creates a geographic marker.

Supports an optional country hint used for intelligent camera positioning.

Example:

createMarker(
  latitude,
  longitude,
  label,
  country
)

For locations where a country cannot meaningfully be associated with the point, the model can use:

VAGUE
createPath

Creates a path connecting multiple geographic points.

createPath(
  points[]
)

Paths use the same underlying geographic point model as markers.

createPolygon

Creates a geographic polygon from a named region.

The server uses the Nominatim Search API with GeoJSON polygon output to retrieve the boundary.

Region
  ↓
Nominatim
  ↓
GeoJSON
  ↓
Point conversion
  ↓
Polygon
  ↓
MapLibre

Both Polygon and MultiPolygon GeoJSON geometries are handled.

renderScene

Serializes the current scene and sends it to the MCP App for rendering.

The scene contains objects such as:

Scene
 ├── Markers
 ├── Paths
 └── Polygons
Country-Aware Camera

GPT Maps uses country information associated with markers to improve the initial map viewport.

For example:

User:
Show Delhi

The marker can carry:

country = "India"

The server resolves the country's bounding box through Nominatim.

The renderer then combines:

Marker bounds
        +
Country bounds
        ↓
Combined LngLatBounds
        ↓
MapLibre fitBounds()

This prevents a single marker from producing an excessively zoomed-in view.

If:

the country is unavailable,
the value is VAGUE, or
Nominatim cannot resolve the country,

the renderer safely falls back to the geographic bounds of the scene objects.

Country requests are also deduplicated within each scene so multiple markers from the same country do not trigger repeated lookups.

Map Rendering

The frontend uses MapLibre GL for rendering.

The renderer maintains the map as a visual representation of the current scene.

Before rendering a new independent scene, existing map objects are cleared:

New renderScene()
       ↓
clearMap()
       ↓
Remove previous markers
Remove previous paths
Remove previous polygons
       ↓
Render new scene

This prevents objects from previous independent prompts from accumulating on the same map.

MCP App Sandbox

The MCP App runs inside a sandboxed iframe controlled by the MCP host.

A standard Vite build normally produces:

index.html
assets/
 ├── index.js
 └── index.css

However, those relative asset URLs are not directly accessible from the MCP App sandbox.

GPT Maps therefore produces a self-contained HTML resource with JavaScript and CSS bundled into the HTML document.

The resulting MCP resource contains:

<script>
  ...
</script>

<style>
  ...
</style>

with no required:

./assets/
 /assets/

references.

This allows the MCP host to load the entire application from a single HTML resource.

Content Security Policy

MapLibre requires external network access for map resources.

The MCP App therefore declares the required external domain through MCP resource CSP metadata.

For example:

connectDomains:
  https://demotiles.maplibre.org

The CSP metadata is included in the actual resources/read response so the MCP host can apply the required policy when loading the application.

Technology Stack
Backend
TypeScript
Node.js
MCP SDK
Nominatim / OpenStreetMap
GeoJSON
Frontend
React
TypeScript
MapLibre GL
HTML/CSS
Architecture
TypeScript monorepo
Shared domain models
Scene Builder
Serialization / deserialization pipeline
MCP resources and tools
Distribution
MCPB
Claude Desktop
Project Structure
packages/
├── shared/
│   └── Shared scene/domain models
│
├── server/
│   ├── MCP server
│   ├── MCP tools
│   ├── BoundaryService
│   └── SceneSerializer
│
└── web/
    ├── React MCP App
    ├── MapRenderer
    └── SceneDeserializer
Running Locally
Requirements
Node.js
npm
Claude Desktop
MCPB CLI (for packaging)
Install
npm install
Build
npm run build
Package

The project can be packaged as an MCPB extension using the official MCPB CLI.

mcpb pack

The resulting package can then be installed into Claude Desktop.

MCPB

GPT Maps is distributed as a Claude Desktop MCPB extension.

The package contains:

map-renderer.mcpb

The package is a ZIP-based MCPB archive containing the server, web application, manifest, and required dependencies.

Engineering Highlights

Some of the main engineering challenges addressed in the project include:

MCP App asset delivery

Solved the mismatch between standard Vite asset output and the MCP App sandbox by producing a self-contained HTML resource.

MCP resource CSP

Configured CSP metadata so the sandboxed MapLibre application can access required external map resources.

Scene serialization

Designed a shared scene representation that allows the MCP server and React frontend to communicate using the same map object model.

Geographic boundary resolution

Integrated Nominatim and GeoJSON to dynamically retrieve geographic boundaries instead of storing hardcoded polygon geometry.

Camera management

Implemented combined object and country bounding-box calculations to automatically choose an appropriate map viewport.

Scene lifecycle

Implemented explicit map cleanup before rendering independent scenes to prevent visual state from leaking between prompts.

Future Improvements

Potential future improvements include:

Geographic data caching
More map providers and styles
Additional geographic tools
Better region/country detection
More advanced camera heuristics
Route-based path generation
Layer management
Larger-scale geographic datasets
License

This project is currently intended as a personal/portfolio project.


### One small GitHub naming detail

I'd use:

**Repository:** `gpt-maps-mcp`

**Description:**

> AI-powered MCP server and Claude Desktop App for interactive geographic visualization using markers, paths, and geographic boundaries.

**README title:** `GPT Maps`

And your resume can call it:

> **GPT Maps — MCP Server & Claude Desktop Extension**

That's a clean distinction: **GitHub repo name = technical identifier**, while **resume name = recruiter-friendly project name**.