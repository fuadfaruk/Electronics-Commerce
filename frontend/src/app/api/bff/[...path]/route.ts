import { unstable_rethrow } from "next/navigation";
import { getStorefrontConfig } from "@/lib/api/config";
import { allowBody, allowQuery, allowSetCookie, checkSameOrigin, commerceRoute, upstreamHeaders } from "@/lib/api/bff-policy";
import { ApiRequestError, readApiProblem, readBoundedText, safeProblem } from "@/lib/api/errors";
import { decodeCommerce, responseJson } from "@/lib/api/response";
import { mockCommerceRead } from "@/lib/catalog/mock";

export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie, Origin, Sec-Fetch-Site",
  "X-Content-Type-Options": "nosniff",
};

async function handle(request: Request, ctx: RouteContext<"/api/bff/[...path]">): Promise<Response> {
  try {
    const config = getStorefrontConfig();
    checkSameOrigin(request, config.storefrontOrigin);
    const { path } = await ctx.params;
    const route = commerceRoute(request.method, path);
    if (!route) return Response.json(safeProblem(404), { status: 404, headers: RESPONSE_HEADERS });
    const query = allowQuery(new URL(request.url).searchParams, route);
    if (config.mode === "mock") {
      if (request.method !== "GET" || !route.mockRead) throw new ApiRequestError({ status: 403, code: "MOCK_READ_ONLY" });
      const payload = mockCommerceRead(route.path, query);
      return Response.json(decodeCommerce(route.kind, payload, "mock"), { headers: RESPONSE_HEADERS });
    }
    const headers = upstreamHeaders(request);
    let body: string | undefined;
    if (request.method !== "GET") {
      if (!headers.has("X-CSRF-Token")) throw new ApiRequestError({ status: 400, code: "CSRF_FAILED" });
      if ((route.path === "Order" || route.path.endsWith("/stock")) && !headers.has("Idempotency-Key")) throw new ApiRequestError({ status: 400 });
      const raw = await readBoundedText(request, 65_536);
      if (raw) {
        if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) throw new ApiRequestError({ status: 400 });
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { throw new ApiRequestError({ status: 400 }); }
        const allowed = allowBody(route.path, request.method, parsed);
        body = allowed === undefined ? undefined : JSON.stringify(allowed);
      } else {
        allowBody(route.path, request.method, null);
      }
      if (body !== undefined) headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${config.apiBaseUrl}/api/v1/${route.path}${query.size ? `?${query}` : ""}`, {
      method: request.method, headers, body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000),
    });
    const outgoing = new Headers(RESPONSE_HEADERS);
    for (const cookie of response.headers.getSetCookie()) {
      if (allowSetCookie(cookie, new URL(config.storefrontOrigin).protocol === "https:")) outgoing.append("Set-Cookie", cookie);
    }
    if (!response.ok) {
      const problem = await readApiProblem(response);
      const status = response.status >= 400 ? response.status : 502;
      return Response.json({ ...problem, status }, { status, headers: outgoing });
    }
    if (response.status === 204 && route.kind === "empty") return new Response(null, { status: 204, headers: outgoing });
    const payload = decodeCommerce(route.kind, await responseJson(response));
    return Response.json(payload, { status: response.status, headers: outgoing });
  } catch (error) {
    unstable_rethrow(error);
    const problem = error instanceof ApiRequestError ? error.problem : safeProblem(503);
    return Response.json(problem, { status: problem.status, headers: RESPONSE_HEADERS });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
