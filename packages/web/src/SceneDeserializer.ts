import {
  Animation,
  Metadata,
  Point,
  Scene,
  SceneBuilder,
  Style,
  LineString,
  PolygonGeometry,
} from "@map-renderer/shared";

export class SceneDeserializer {
  public deserialize(serializedScene: object): { scene: Scene; countryBounds: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> | null } {
    const scene = new Scene();
    const sceneBuilder = new SceneBuilder(scene);
    const parsed = serializedScene as {
      objects?: unknown[];
      countryBounds?: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }>;
    };
    const objects = parsed.objects ?? [];
    const countryBounds = parsed.countryBounds ?? null;

    for (const object of objects) {
      const item = object as {
        type?: string;
        id?: string;
        visible?: boolean;
        country?: string;
        style?: {
          color?: string;
          opacity?: number;
          width?: number;
        };
        metadata?: {
          name?: string;
          description?: string;
        };
        animation?: {
          enabled?: boolean;
          duration?: number;
        };
        geometry?: {
          latitude?: number;
          longitude?: number;
          points?: Array<{
            latitude?: number;
            longitude?: number;
          }>;
        };
      };

      const style = new Style(
        item.style?.color ?? "#000000",
        item.style?.opacity ?? 1,
        item.style?.width ?? 1
      );
      const metadata = new Metadata(
        item.metadata?.name ?? "",
        item.metadata?.description ?? ""
      );
      const animation = new Animation(
        item.animation?.enabled ?? false,
        item.animation?.duration ?? 0
      );

      if (item.type === "marker") {
        sceneBuilder.createMarker(
          item.id ?? crypto.randomUUID(),
          item.visible ?? true,
          style,
          metadata,
          animation,
          new Point(
            item.geometry?.latitude ?? 0,
            item.geometry?.longitude ?? 0
          ),
          item.country
        );
        continue;
      }

      if (item.type === "path") {
        sceneBuilder.createPath(
          item.id ?? crypto.randomUUID(),
          item.visible ?? true,
          style,
          metadata,
          animation,
          new LineString(
            (item.geometry?.points ?? []).map((point) => new Point(
              point.latitude ?? 0,
              point.longitude ?? 0
            ))
          )
        );
        continue;
      }

      if (item.type === "polygon") {
        sceneBuilder.createPolygon(
          item.id ?? crypto.randomUUID(),
          item.visible ?? true,
          style,
          metadata,
          animation,
          new PolygonGeometry(
            (item.geometry?.points ?? []).map((point) => new Point(
              point.latitude ?? 0,
              point.longitude ?? 0
            ))
          )
        );
      }
    }

    return { scene, countryBounds };
  }
}
