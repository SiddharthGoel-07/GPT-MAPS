/**
 * An error whose message is safe to show to the caller, with the HTTP status
 * the API should answer with. Anything else is reported as a generic 500.
 */
export class ChatError extends Error {
  public readonly status: number;

  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ChatError";
    this.status = status;
  }
}

export function deadlineError(): ChatError {
  return new ChatError(504, "The request took too long and was cancelled. Try a simpler prompt.");
}
