export class DomainError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "invalid" | "forbidden",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
