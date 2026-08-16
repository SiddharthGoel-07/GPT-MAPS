import {
  Animation,
  Label,
  Metadata,
  Point,
  Scene,
  SceneBuilder,
  Style,
  LineString,
  PolygonGeometry,
} from "@map-renderer/shared";

export class SceneDeserializer {
  public deserialize(serializedScene: object): Scene {
    const scene = new Scene();
    const sceneBuilder = new SceneBuilder(scene);
    const objects = (serializedScene as { objects?: unknown[] }).objects ?? [];

    for (const object of objects) {
      const item = object as {
        type?: string;
        id?: string;
        visible?: boolean;
        style?: {
          color?: string;
          opacity?: number;
          width?: number;
          options?: {
            size?: number;
            dash?: boolean;
            fillColor?: string;
            fillOpacity?: number;
            borderColor?: string;
            borderWidth?: number;
            borderDash?: boolean;
            fontSize?: number;
            fontWeight?: string;
            backgroundColor?: string;
          };
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
        text?: string;
      };

      const style = new Style(
        item.style?.color ?? "#000000",
        item.style?.opacity ?? 1,
        item.style?.width ?? 1,
        {
          size: item.style?.options?.size,
          dash: item.style?.options?.dash,
          fillColor: item.style?.options?.fillColor,
          fillOpacity: item.style?.options?.fillOpacity,
          borderColor: item.style?.options?.borderColor,
          borderWidth: item.style?.options?.borderWidth,
          borderDash: item.style?.options?.borderDash,
          fontSize: item.style?.options?.fontSize,
          fontWeight: item.style?.options?.fontWeight,
          backgroundColor: item.style?.options?.backgroundColor,
        }
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
          )
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
        continue;
      }

      if (item.type === "label") {
        sceneBuilder.createLabel(
          item.id ?? crypto.randomUUID(),
          item.visible ?? true,
          style,
          metadata,
          animation,
          new Point(
            item.geometry?.latitude ?? 0,
            item.geometry?.longitude ?? 0
          ),
          item.text ?? ""
        );
      }
    }

    return scene;
  }
}