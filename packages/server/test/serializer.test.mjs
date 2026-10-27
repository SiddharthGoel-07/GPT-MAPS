// Unit test: the server refuses to emit an invalid scene.
// Uses the built output (run after building shared + server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SceneValidationError } from "@map-renderer/shared";
import { RequestContext } from "../dist/RequestContext.js";
import { SceneSerializer } from "../dist/SceneSerializer.js";

const good = { type: "marker", id: "m1", name: "x", position: [77, 28], color: "red", opacity: 1, size: 1 };

test("valid context scene serialises", () => {
  const ctx = new RequestContext();
  ctx.add(good);
  const out = new SceneSerializer().serialize(ctx.toScene());
  assert.equal(out.version, 1);
  assert.equal(out.objects.length, 1);
});

test("invalid scenes are rejected before leaving the server", () => {
  const s = new SceneSerializer();
  const bad = [
    { version: 1, objects: [{ ...good, position: [77] }] },
    { version: 1, objects: [{ ...good, position: [77, 95] }] },
    { version: 1, objects: [{ ...good, color: "bogus" }] },
    { version: 1, objects: [good, good] },
    { version: 2, objects: [] },
    { objects: [] },
  ];
  for (const scene of bad) assert.throws(() => s.serialize(scene), SceneValidationError);
});

test("RequestContext: toScene is a copy, remove/reset work", () => {
  const ctx = new RequestContext();
  ctx.add(good);
  const snap = ctx.toScene();
  snap.objects.length = 0;
  assert.equal(ctx.count(), 1);
  assert.equal(ctx.get("m1")?.type, "marker");
  ctx.remove("m1");
  assert.equal(ctx.count(), 0);
  ctx.add(good); ctx.keys.set("k", "m1");
  ctx.reset();
  assert.equal(ctx.count(), 0);
  assert.equal(ctx.keys.size, 0);
});
