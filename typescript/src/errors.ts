/** Base class for every error the SDK throws. Catch this to catch them all. */
export class MaritimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaritimeError'
    // Restore prototype chain when compiled to ES5-ish targets.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** The request never reached Maritime (DNS, connection refused, timeout, …). */
export class MaritimeConnectionError extends MaritimeError {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'MaritimeConnectionError'
    this.cause = cause
  }
}

/** Maritime returned a non-2xx response. Subclassed by status below. */
export class MaritimeAPIError extends MaritimeError {
  readonly status: number
  readonly detail: string
  /** Value of the `x-request-id` response header, when present. */
  readonly requestId?: string

  constructor(status: number, detail: string, requestId?: string) {
    super(`Maritime API error ${status}: ${detail}`)
    this.name = 'MaritimeAPIError'
    this.status = status
    this.detail = detail
    this.requestId = requestId
  }
}

/** 401 / 403: bad or insufficiently-scoped API key. */
export class MaritimeAuthError extends MaritimeAPIError {
  constructor(status: number, detail: string, requestId?: string) {
    super(status, detail, requestId)
    this.name = 'MaritimeAuthError'
  }
}

/**
 * 402, a billing gate blocked the action: the plan's machine limit is reached,
 * the action needs a paid add-on, or the plan lapsed.
 *
 * One plan covers everything the account runs. A machine is one micro-VM, and
 * an agent and a Computer each take one slot, so the same gate answers both.
 *
 * `detail` is the server's message verbatim and is already a complete
 * user-ready sentence naming the fix and carrying the billing link, e.g.
 * "You are on the free plan, which includes 3 agents (you have 3). Delete an
 * agent you no longer need, or upgrade to a paid plan to create more:
 * https://maritime.sh/billing". Surface it as-is instead of writing your own
 * reason: one status covers several distinct gates and only the message says
 * which one closed.
 */
export class MaritimePaymentRequiredError extends MaritimeAPIError {
  constructor(status: number, detail: string, requestId?: string) {
    super(status, detail, requestId)
    this.name = 'MaritimePaymentRequiredError'
  }
}

/** 404: the agent (or other resource) does not exist or is not yours. */
export class MaritimeNotFoundError extends MaritimeAPIError {
  constructor(status: number, detail: string, requestId?: string) {
    super(status, detail, requestId)
    this.name = 'MaritimeNotFoundError'
  }
}

/** 409: a uniqueness conflict (e.g. an agent with that name already exists). */
export class MaritimeConflictError extends MaritimeAPIError {
  constructor(status: number, detail: string, requestId?: string) {
    super(status, detail, requestId)
    this.name = 'MaritimeConflictError'
  }
}

/** 429: rate limited. */
export class MaritimeRateLimitError extends MaritimeAPIError {
  constructor(status: number, detail: string, requestId?: string) {
    super(status, detail, requestId)
    this.name = 'MaritimeRateLimitError'
  }
}

/** Build the most specific error subclass for an HTTP status. */
export function apiErrorFromStatus(
  status: number,
  detail: string,
  requestId?: string,
): MaritimeAPIError {
  switch (status) {
    case 401:
    case 403:
      return new MaritimeAuthError(status, detail, requestId)
    case 402:
      return new MaritimePaymentRequiredError(status, detail, requestId)
    case 404:
      return new MaritimeNotFoundError(status, detail, requestId)
    case 409:
      return new MaritimeConflictError(status, detail, requestId)
    case 429:
      return new MaritimeRateLimitError(status, detail, requestId)
    default:
      return new MaritimeAPIError(status, detail, requestId)
  }
}
