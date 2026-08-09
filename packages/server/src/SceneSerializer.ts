import {
  Marker,
  Path,
  Polygon,
  Scene,
} from "@map-renderer/shared";
import { BoundaryService } from "./services/BoundaryService.js";

export class SceneSerializer {
  constructor(
    private readonly boundaryService: BoundaryService
  ) {}

  public async serialize(scene: Scene): Promise<object> {
    const countriesToLookup = new Set<string>();
    const markers: any[] = [];

    for (const object of scene.getObjects()) {
      if (object instanceof Marker) {
        const base: any = {
          type: "marker",
          id: object.id,
          visible: object.visible,
          style: object.style,
          metadata: object.metadata,
          animation: object.animation,
          geometry: object.geometry,
        };

        if (object.country !== undefined && object.country !== "VAGUE") {
          base.country = object.country;
          countriesToLookup.add(object.country);
        }

        markers.push(base);
      } else if (object instanceof Path) {
        markers.push({
          type: "path",
          id: object.id,
          visible: object.visible,
          style: object.style,
          metadata: object.metadata,
          animation: object.animation,
          geometry: object.geometry,
        });
      } else if (object instanceof Polygon) {
        markers.push({
          type: "polygon",
          id: object.id,
          visible: object.visible,
          style: object.style,
          metadata: object.metadata,
          animation: object.animation,
          geometry: object.geometry,
        });
      } else {
        throw new Error("Unsupported scene object.");
      }
    }

    const countryBounds: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> = {};

    for (const country of countriesToLookup) {
      const bounds = await this.boundaryService.getCountryBounds(country);
      if (bounds) {
        countryBounds[country] = bounds;
      }
    }

    return {
      objects: markers,
      countryBounds,
    };
  }
}
