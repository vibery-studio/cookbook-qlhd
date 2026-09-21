/**
 * Error classes for infrastructure failures — thrown when the client
 * couldn't reach the server or couldn't parse a well-formed response.
 *
 * Domain errors (a 4xx/5xx with a Problem+JSON body) do NOT throw;
 * they arrive as `Result.ok === false`. See `runtime/result.ts`.
 */

export class ClientError extends Error {
  public override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ClientError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Network unreachable / DNS / TLS / connection refused. */
export class NetworkError extends ClientError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "NetworkError";
  }
}

/** Response declared JSON content-type but the body failed to parse. */
export class ResponseParseError extends ClientError {
  constructor(
    message: string,
    public readonly status: number,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ResponseParseError";
  }
}
