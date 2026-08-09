import { App } from "@modelcontextprotocol/ext-apps";

import { SceneDeserializer } from "./SceneDeserializer.js";
import { RendererContext } from "./RendererContext.js";

export const app = new App({
  name: "Map Renderer",
  version: "0.1.0",
});

const sceneDeserializer = new SceneDeserializer();

async function initialize(): Promise<void> {
  await app.connect();
}

initialize().catch(console.error);

app.ontoolresult = (result) => {
  try {
    const serializedScene =
      JSON.parse(result.content[0].text);

    const { scene, countryBounds } =
      sceneDeserializer.deserialize(serializedScene);

    RendererContext.renderer?.renderWithCountryContext(scene, countryBounds);
  }
  catch (error) {
    console.error(error);
  }
};
