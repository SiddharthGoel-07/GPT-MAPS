import type { TripFollowUpResponse, TripPlanResponse } from "@map-renderer/shared";

import { ChatRequestError, describeFailure, type SendChatOptions } from "./chatClient.js";

function headers(authToken: string | undefined, extra: Record<string, string>): Record<string, string> {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

async function errorMessageOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

function handleLine(
  line: string,
  onProgress: ((text: string) => void) | undefined
): TripPlanResponse | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new ChatRequestError("The AI server sent an unreadable answer.", "stream", null);
  }
  if (event.type === "progress" && typeof event.text === "string") {
    onProgress?.(event.text);
    return null;
  }
  if (event.type === "error") {
    const status = typeof event.status === "number" ? event.status : 500;
    const text = typeof event.error === "string" ? event.error : undefined;
    throw new ChatRequestError(describeFailure(status, text), "http", status);
  }
  if (event.type === "result") {
    const { type: _type, ...rest } = event;
    void _type;
    return rest as unknown as TripPlanResponse;
  }
  return null;
}

export type SendTripOptions = Pick<SendChatOptions, "baseUrl" | "prompt" | "authToken" | "onProgress" | "signal" | "fetchImpl">;

export async function sendTripPlan(options: SendTripOptions): Promise<TripPlanResponse> {
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl}/api/trip`, {
      method: "POST",
      headers: headers(options.authToken, {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      }),
      body: JSON.stringify({ prompt: options.prompt }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError(describeFailure(null, undefined), "network", null);
  }

  if (!response.ok) {
    throw new ChatRequestError(
      describeFailure(response.status, await errorMessageOf(response)),
      "http",
      response.status
    );
  }
  if (!response.body) {
    throw new ChatRequestError("The AI server sent an empty answer.", "stream", null);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TripPlanResponse | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) result = handleLine(line, options.onProgress) ?? result;
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError("The connection to the AI server was lost.", "stream", null);
  }

  const last = buffer.trim();
  if (last) result = handleLine(last, options.onProgress) ?? result;

  if (!result) {
    throw new ChatRequestError("The AI server ended without a trip plan.", "stream", null);
  }
  return result;
}

export interface TripFollowUpRequest {
  prompt: string;
  tripTitle: string;
  section: "overview" | number;
  sectionTitle?: string | undefined;
  currentNarrative: string;
  history?: Array<{ role: "user" | "assistant"; content: string }> | undefined;
}

function handleFollowUpLine(
  line: string,
  onProgress: ((text: string) => void) | undefined
): TripFollowUpResponse | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new ChatRequestError("The AI server sent an unreadable answer.", "stream", null);
  }
  if (event.type === "progress" && typeof event.text === "string") {
    onProgress?.(event.text);
    return null;
  }
  if (event.type === "error") {
    const status = typeof event.status === "number" ? event.status : 500;
    const text = typeof event.error === "string" ? event.error : undefined;
    throw new ChatRequestError(describeFailure(status, text), "http", status);
  }
  if (event.type === "result") {
    const { type: _type, ...rest } = event;
    void _type;
    return rest as unknown as TripFollowUpResponse;
  }
  return null;
}

export async function sendTripFollowUp(
  options: SendTripOptions & { body: TripFollowUpRequest }
): Promise<TripFollowUpResponse> {
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl}/api/trip/followup`, {
      method: "POST",
      headers: headers(options.authToken, {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      }),
      body: JSON.stringify({ ...options.body, prompt: options.prompt }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError(describeFailure(null, undefined), "network", null);
  }

  if (!response.ok) {
    throw new ChatRequestError(
      describeFailure(response.status, await errorMessageOf(response)),
      "http",
      response.status
    );
  }
  if (!response.body) {
    throw new ChatRequestError("The AI server sent an empty answer.", "stream", null);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TripFollowUpResponse | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) result = handleFollowUpLine(line, options.onProgress) ?? result;
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError("The connection to the AI server was lost.", "stream", null);
  }

  const last = buffer.trim();
  if (last) result = handleFollowUpLine(last, options.onProgress) ?? result;

  if (!result) {
    throw new ChatRequestError("The AI server ended without an update.", "stream", null);
  }
  return result;
}
