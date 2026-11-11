/** TomTom API key from packages/server/.env (not committed). */
export function readTomTomApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.TOMTOM_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}
