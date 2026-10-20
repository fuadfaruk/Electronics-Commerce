import { unstable_rethrow } from "next/navigation";
import type { ApiProblem, ApiResult } from "@/types/api";

export class ApiRequestError extends Error {
  constructor(
    public readonly problem: ApiProblem,
    options?: ErrorOptions,
  ) {
    super(problem.detail, options);
    this.name = "ApiRequestError";
  }
}

/** Return expected failures as data so Next.js does not redact them in production. */
export async function getApiResult<T>(
  request: () => Promise<T>,
): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await request() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiRequestError) {
      return { ok: false, problem: error.problem };
    }
    throw error;
  }
}

function message(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

/** Messages and connection codes only, never an exception stack. */
export function describeError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return message(error);

  const cause = error.cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? message(cause.code)
      : undefined;
  const causeMessage = cause instanceof Error ? message(cause.message) : undefined;
  return (
    [...new Set([message(error.message), code, causeMessage])]
      .filter(Boolean)
      .join(": ") || undefined
  );
}

export async function readApiProblem(
  response: Response,
  url: string,
  method = "GET",
): Promise<ApiProblem> {
  const status = [response.status, response.statusText].filter(Boolean).join(" ");
  const fallbackDetail = `${method} ${url} failed with ${status}.`;
  let payload: unknown;

  try {
    const body = await response.text();
    try {
      payload = JSON.parse(body);
    } catch {
      payload = body;
    }
  } catch (error) {
    unstable_rethrow(error);
    // The HTTP status is still useful when the error body cannot be read.
  }

  const problem =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const textBody = typeof payload === "string" ? payload.trim() : "";
  const isHtml = /<(?:!doctype|html|head|body)\b/i.test(textBody);
  const plainMessage = isHtml ? undefined : message(textBody.split(/\r?\n/)[0]);
  const errors =
    problem.errors &&
    typeof problem.errors === "object" &&
    !Array.isArray(problem.errors)
      ? Object.fromEntries(
          Object.entries(problem.errors)
            .slice(0, 20)
            .map(([field, values]): [string, string[]] => [
              field,
              (Array.isArray(values) ? values : [values])
                .map(message)
                .filter((value): value is string => value !== undefined)
                .slice(0, 5),
            ])
            .filter(([, values]) => values.length > 0),
        )
      : undefined;

  return {
    title: message(problem.title) ?? (response.statusText || "API request failed"),
    detail:
      message(problem.detail) ??
      message(problem.message) ??
      message(problem.error) ??
      plainMessage ??
      `${fallbackDetail}${isHtml ? " The API returned an HTML error page instead of JSON." : ""}`,
    status: response.status,
    method,
    url,
    type: message(problem.type),
    traceId: message(problem.traceId),
    errors,
  };
}
