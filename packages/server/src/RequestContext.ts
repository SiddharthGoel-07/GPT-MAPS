import { SCENE_VERSION } from "@map-renderer/shared";
import type { Scene, SceneObject } from "@map-renderer/shared";

/**
 * Holds the scene being built for one MCP session.
 *
 * Objects are plain data (see the shared scene schema). The only way to
 * change them is add/remove/reset, and `toScene()` hands out a copy, so
 * nothing outside this class can mutate the scene behind its back.
 */
export class RequestContext {
  private objects: SceneObject[] = [];

  /**
   * De-duplication index for this scene: semantic key -> object id.
   * Keys are built from coordinates (see sceneOps.ts), so "Delhi" and
   * "New Delhi, India" resolve to the same marker. Must always be kept in
   * sync with the objects; reset() clears it.
   */
  public readonly keys = new Map<string, string>();

  public add(object: SceneObject): void {
    this.objects.push(object);
  }

  public remove(id: string): void {
    this.objects = this.objects.filter((o) => o.id !== id);
  }

  public get(id: string): SceneObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  public count(): number {
    return this.objects.length;
  }

  /** A snapshot copy; not validated here (SceneSerializer does that). */
  public toScene(): Scene {
    return { version: SCENE_VERSION, objects: [...this.objects] };
  }

  public reset(): void {
    this.keys.clear();
    this.objects = [];
  }
}
