export type WeatherReading = {
  temperature: number;
  weatherCode: number;
  windSpeed: number;
  fetchedAt: number;
};

export type GeoPoint = { lat: number; lon: number };

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { reading: WeatherReading; expires: number }>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export async function fetchCurrentWeather(
  points: GeoPoint[],
  signal?: AbortSignal
): Promise<WeatherReading[]> {
  if (points.length === 0) return [];

  const now = Date.now();
  const results: (WeatherReading | undefined)[] = new Array(points.length);
  const toFetch: { index: number; lat: number; lon: number }[] = [];

  points.forEach((p, index) => {
    const hit = cache.get(cacheKey(p.lat, p.lon));
    if (hit && hit.expires > now) {
      results[index] = hit.reading;
    } else {
      toFetch.push({ index, lat: p.lat, lon: p.lon });
    }
  });

  if (toFetch.length > 0) {
    const latitudes = toFetch.map((p) => p.lat).join(",");
    const longitudes = toFetch.map((p) => p.lon).join(",");
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitudes}` +
      `&longitude=${longitudes}` +
      "&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh";

    const init: RequestInit = signal ? { signal } : {};
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Weather request failed (${res.status})`);

    type ForecastBlock = {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    };

    const raw = (await res.json()) as ForecastBlock | ForecastBlock[];
    const blocks = Array.isArray(raw) ? raw : [raw];

    toFetch.forEach((item, i) => {
      const current = blocks[i]?.current;
      if (!current) return;

      const reading: WeatherReading = {
        temperature: Math.round(current.temperature_2m ?? 0),
        weatherCode: current.weather_code ?? 0,
        windSpeed: Math.round(current.wind_speed_10m ?? 0),
        fetchedAt: now,
      };
      cache.set(cacheKey(item.lat, item.lon), { reading, expires: now + CACHE_TTL_MS });
      results[item.index] = reading;
    });
  }

  return points.map((_, index) => {
    const reading = results[index];
    if (reading) return reading;
    throw new Error("Weather data missing for a location");
  });
}
