import { Point, PolygonGeometry } from "@map-renderer/shared";

export class BoundaryService {
  public async getBoundary(
    location: string
  ): Promise<PolygonGeometry> {
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
      throw new Error(
        `Nominatim request failed with status ${response.status}.`
      );
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      throw new Error(`Boundary for "${location}" not found.`);
    }

    const feature = data.features[0];
    const geometry = feature.geometry;

    if (!geometry) {
      throw new Error(
        `Invalid GeoJSON: missing geometry for "${location}".`
      );
    }

    const points = this.extractPoints(geometry);

    if (points.length === 0) {
      throw new Error(
        `No valid coordinates found for "${location}".`
      );
    }

    return new PolygonGeometry(points);
  }

  public async getCountryBounds(
    country: string
  ): Promise<{ minLat: number; maxLat: number; minLon: number; maxLon: number } | null> {
    const params = new URLSearchParams({
      q: country,
      format: "geojson",
      polygon_geojson: "1",
      limit: "1",
    });

    const url = `https://nominatim.openstreetmap.org/search?${params}`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "map-renderer-mcp/0.1.0",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (!data.features || data.features.length === 0) {
        return null;
      }

      const feature = data.features[0];
      const bbox = feature.bbox;

      if (!bbox || bbox.length < 4) {
        return null;
      }

      return {
        minLon: bbox[0],
        minLat: bbox[1],
        maxLon: bbox[2],
        maxLat: bbox[3],
      };
    } catch {
      return null;
    }
  }

  private extractPoints(geometry: any): Point[] {
    const points: Point[] = [];

    if (geometry.type === "Polygon") {
      const coordinates = geometry.coordinates[0];
      for (const [lon, lat] of coordinates) {
        points.push(new Point(lat, lon));
      }
    } else if (geometry.type === "MultiPolygon") {
      const firstPolygon = geometry.coordinates[0];
      const coordinates = firstPolygon[0];
      for (const [lon, lat] of coordinates) {
        points.push(new Point(lat, lon));
      }
    } else {
      throw new Error(
        `Unsupported geometry type: ${geometry.type}. Expected Polygon or MultiPolygon.`
      );
    }

    return points;
  }
}
