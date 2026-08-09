import { DrawableObject } from "../objects/DrawableObject.js";

/**
 * Represents the current state of the map.
 */
export class Scene {
  private readonly objects: DrawableObject[] = [];

  addObject(object: DrawableObject): void {
    this.objects.push(object);
  }

  removeObject(id: string): void {
    const index = this.objects.findIndex(object => object.id === id);

    if (index !== -1) {
      this.objects.splice(index, 1);
    }
  }

  getObjectById(id: string): DrawableObject | undefined {
    return this.objects.find(object => object.id === id);
  }

  getObjects(): readonly DrawableObject[] {
    return this.objects;
  }
}