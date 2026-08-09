import { Point } from "@map-renderer/shared";
export class GeocodingService {
    async getCoordinates(location) {
        const url = `https://nominatim.openstreetmap.org/search?` +
            new URLSearchParams({
                q: location,
                format: "jsonv2",
                limit: "1",
            });
        const response = await fetch(url, {
            headers: {
                "User-Agent": "map-renderer-mcp",
            },
        });
        if (!response.ok) {
            throw new Error("Failed to geocode location.");
        }
        const results = await response.json();
        if (results.length === 0) {
            throw new Error(`Location "${location}" not found.`);
        }
        return new Point(Number(results[0].lat), Number(results[0].lon));
    }
}
//# sourceMappingURL=GeocodingService.js.map