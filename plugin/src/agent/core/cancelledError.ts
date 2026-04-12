export class CancelledError extends Error {
  constructor(message = "operation cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export function isCancelledError(error: unknown): boolean {
  if (error instanceof CancelledError) {
    return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

export function throwIfCancelled(signal?: AbortSignal, isCancelled?: () => boolean): void {
  if (signal?.aborted || isCancelled?.()) {
    throw new CancelledError();
  }
}
