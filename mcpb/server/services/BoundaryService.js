import { Point, PolygonGeometry } from "@map-renderer/shared";
export class BoundaryService {
    async getBoundary(location) {
        const params = new URLSearchParams({
            q: location,
            format: "geojson",
            polygon_geojson: "1",
            limit: "1",
        });
        const url = `https://nominatim.openstreetmap.org/search?${params}`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": "map-renderer-mcp/0.1.0",
            },
        });
        if (!response.ok) {
            throw new Error(`Nominatim request failed with status ${response.status}.`);
        }
        const data = await response.json();
        if (!data.features || data.features.length === 0) {
            throw new Error(`Boundary for "${location}" not found.`);
        }
        const feature = data.features[0];
        const geometry = feature.geometry;
        if (!geometry) {
            throw new Error(`Invalid GeoJSON: missing geometry for "${location}".`);
        }
        const points = this.extractPoints(geometry);
        if (points.length === 0) {
            throw new Error(`No valid coordinates found for "${location}".`);
        }
        return new PolygonGeometry(points);
    }
    extractPoints(geometry) {
        const points = [];
        if (geometry.type === "Polygon") {
            const coordinates = geometry.coordinates[0];
            for (const [lon, lat] of coordinates) {
                points.push(new Point(lat, lon));
            }
        }
        else if (geometry.type === "MultiPolygon") {
            const firstPolygon = geometry.coordinates[0];
            const coordinates = firstPolygon[0];
            for (const [lon, lat] of coordinates) {
                points.push(new Point(lat, lon));
            }
        }
        else {
            throw new Error(`Unsupported geometry type: ${geometry.type}. Expected Polygon or MultiPolygon.`);
        }
        return points;
    }
}
//# sourceMappingURL=BoundaryService.js.map