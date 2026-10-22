import { unstable_rethrow } from "next/navigation";
import type { ApiProblem, ApiResult } from "@/types/api";

const SAFE_MESSAGES: Record<string, [string, string]> = {
  VALIDATION_FAILED: ["Check your details", "Some details are missing or invalid. Check the form and try again."],
  SIGN_IN_REQUIRED: ["Sign in required", "Your account session is unavailable or has expired. Sign in again before continuing."],
  INVALID_CREDENTIALS: ["Sign in unsuccessful", "The email or password could not be accepted."],
  EMAIL_NOT_VERIFIED: ["Verify your email", "Verify your account email before checking out or claiming an order."],
  FORBIDDEN: ["Action unavailable", "You do not have access to this action."],
  NOT_FOUND: ["Not available", "This information is unavailable, or you do not have access to it."],
  CONFLICT: ["Information changed", "The information has changed. Review the latest details before trying again."],
  STOCK_CHANGED: ["Availability changed", "Some quantities are no longer available. Update the cart and request a new quote."],
  PRICE_CHANGED: ["Price changed", "Prices or delivery charges have changed. Review and accept a fresh quote."],
  QUOTE_EXPIRED: ["Quote expired", "Request a fresh quote and review its total before placing an order."],
  PROOF_EXPIRED: ["Email link expired", "This email link is unavailable or expired. Request a fresh link."],
  INVALID_PROOF: ["Email link unavailable", "This email link cannot be used. Request a fresh link."],
  VERSION_CONFLICT: ["Information changed", "Another operation changed this record. Reload it before continuing."],
  IDEMPOTENCY_CONFLICT: ["Checkout attempt differs", "This attempt key belongs to a different request. Do not submit a new order until the earlier attempt is resolved."],
  ATTEMPT_PENDING: ["Checkout is being resolved", "The earlier checkout may still be processing. Check for its receipt before placing another order."],
  IDENTITY_CHANGED: ["Checkout identity changed", "The checkout owner changed. Resolve any earlier attempt before requesting a new quote."],
  CSRF_FAILED: ["Security check failed", "The security check could not be completed. Reload the page before trying again."],
  RATE_LIMITED: ["Please wait", "Too many requests were made. Wait a little before trying again."],
  MOCK_READ_ONLY: ["Sample catalog only", "Accounts and checkout are disabled in mock mode. No live order will be placed."],
  INVALID_RESPONSE: ["Information unavailable", "The store returned information that could not be safely verified. Please try again later."],
  SERVICE_UNAVAILABLE: ["Store temporarily unavailable", "The store could not respond safely. Please try again later."],
  METHOD_NOT_ALLOWED: ["Action unavailable", "This action is not available through the storefront."],
  REQUEST_TOO_LARGE: ["Request too large", "Reduce the size of this request before trying again."],
};

const BACKEND_CODES: Record<string, string> = {
  authentication_required: "SIGN_IN_REQUIRED", session_expired: "SIGN_IN_REQUIRED",
  invalid_credentials: "INVALID_CREDENTIALS", email_not_verified: "EMAIL_NOT_VERIFIED",
  forbidden: "FORBIDDEN", origin_invalid: "FORBIDDEN", csrf_invalid: "CSRF_FAILED",
  not_found: "NOT_FOUND", quote_expired: "QUOTE_EXPIRED", quote_owner_changed: "IDENTITY_CHANGED",
  quote_changed: "PRICE_CHANGED", stock_unavailable: "STOCK_CHANGED", product_unavailable: "STOCK_CHANGED",
  stale_version: "VERSION_CONFLICT", idempotency_conflict: "IDEMPOTENCY_CONFLICT",
  quote_already_accepted: "IDEMPOTENCY_CONFLICT", proof_expired: "PROOF_EXPIRED", proof_invalid: "INVALID_PROOF",
  request_throttled: "RATE_LIMITED", temporarily_unavailable: "SERVICE_UNAVAILABLE",
};

export function safeTraceId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^(?:[a-f0-9]{16,64}|00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]|[0-9A-Z]{13}:[0-9A-F]{8})$/i.test(value)
    ? value : undefined;
}

function defaultCode(status: number): string {
  if (status === 400 || status === 422) return "VALIDATION_FAILED";
  if (status === 401) return "SIGN_IN_REQUIRED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 405) return "METHOD_NOT_ALLOWED";
  if (status === 409) return "CONFLICT";
  if (status === 410) return "PROOF_EXPIRED";
  if (status === 413) return "REQUEST_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  return "SERVICE_UNAVAILABLE";
}

export function safeProblem(status = 503, code?: unknown, traceId?: unknown): ApiProblem {
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503;
  const normalized = typeof code === "string"
    ? (BACKEND_CODES[code] ?? code.toUpperCase()) : "";
  const safeCode = Object.hasOwn(SAFE_MESSAGES, normalized) ? normalized : defaultCode(safeStatus);
  const [title, detail] = SAFE_MESSAGES[safeCode];
  return { code: safeCode, title, detail, status: safeStatus, traceId: safeTraceId(traceId) };
}

export class ApiRequestError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: Pick<ApiProblem, "status"> & Partial<ApiProblem>) {
    const sanitized = safeProblem(problem.status, problem.code, problem.traceId);
    super(sanitized.detail);
    this.name = "ApiRequestError";
    this.problem = sanitized;
  }
}

export async function getApiResult<T>(request: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await request() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiRequestError) return { ok: false, problem: error.problem };
    throw error;
  }
}

export async function readApiProblem(response: Response): Promise<ApiProblem> {
  let payload: Record<string, unknown> = {};
  try {
    const text = await readBoundedText(response, 16_384);
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch (error) {
    unstable_rethrow(error);
  }
  return safeProblem(response.status, payload.code, payload.traceId);
}

export async function readBoundedText(message: Response | Request, limit: number): Promise<string> {
  const reader = message.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new ApiRequestError({ status: 413, code: "REQUEST_TOO_LARGE" });
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
