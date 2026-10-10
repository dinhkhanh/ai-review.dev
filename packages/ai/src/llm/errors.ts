export class LlmError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Safety classifiers declined the request and no fallback model rescued it. */
export class LlmRefusalError extends LlmError {
  constructor(
    readonly category: string | null,
    explanation: string | null,
  ) {
    super(`Model declined the request${category ? ` (${category})` : ""}`, { category, explanation });
    this.name = "LlmRefusalError";
  }
}

/** Output hit max_tokens. Retry with a larger budget or a smaller task. */
export class LlmTruncatedError extends LlmError {
  constructor(maxTokens: number) {
    super(`Output truncated at max_tokens=${maxTokens}`, { maxTokens });
    this.name = "LlmTruncatedError";
  }
}

/** Structured output could not be parsed or failed schema validation. */
export class LlmParseError extends LlmError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
    this.name = "LlmParseError";
  }
}
