import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getStorefrontConfig } from "@/lib/api/config";
import { allowQuery, commerceRoute, selectedCookies } from "@/lib/api/bff-policy";
import { ApiRequestError, readApiProblem } from "@/lib/api/errors";
import { responseJson } from "@/lib/api/response";

/** RSC reads go straight to the API. Cookies are never set here or shared across requests. */
export async function serverGet<T>(path: string, decode: (value: unknown) => T, query = new URLSearchParams()): Promise<T> {
  const config = getStorefrontConfig();
  if (config.mode !== "live") throw new ApiRequestError({ status: 403, code: "MOCK_READ_ONLY" });
  const route = commerceRoute("GET", path.split("/"), config.guestOnly);
  if (!route) throw new ApiRequestError({ status: 404 });
  const params = allowQuery(query, route);
  const header = selectedCookies((await cookies()).getAll());
  const headers = new Headers({ Accept: "application/json" });
  if (header) headers.set("Cookie", header);
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/api/v1/${route.path}${params.size ? `?${params}` : ""}`, {
      method: "GET", headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    unstable_rethrow(error);
    throw new ApiRequestError({ status: 503 });
  }
  if (!response.ok) throw new ApiRequestError(await readApiProblem(response));
  try {
    return decode(await responseJson(response));
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
  }
}
