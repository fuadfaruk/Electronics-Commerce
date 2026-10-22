import { notFound } from "next/navigation";
import { describe, expect, it } from "vitest";
import { ApiRequestError, getApiResult, readApiProblem, readBoundedText, safeProblem } from "@/lib/api/errors";

describe("safe customer problems", () => {
  it("maps recognized codes but never forwards upstream text, URLs, validation values or PII", async () => {
    const problem = await readApiProblem(Response.json({ code: "quote_expired", title: "private customer@example.test", detail: "https://internal/db password", errors: { email: ["PII"] }, url: "https://private", stack: "secret", status: 500, traceId: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" }, { status: 409 }));
    expect(problem).toEqual(safeProblem(409, "QUOTE_EXPIRED", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"));
    expect(JSON.stringify(problem)).not.toMatch(/private|password|PII|secret|https:/);
    expect(Object.keys(problem).sort()).toEqual(["code", "detail", "status", "title", "traceId"]);
  });
  it.each(["<html>secret</html>", "Database error at private/path", JSON.stringify({ code: "unsafe_database_failure", detail: "secret", traceId: "customer@example.test" })])("sanitizes an unknown body %s", async (body) => {
    const p = await readApiProblem(new Response(body, { status: 503 }));
    expect(p).toEqual(safeProblem(503));
    expect(JSON.stringify(p)).not.toContain("secret");
  });
  it.each([400, 401, 403, 404, 405, 409, 413, 429, 500, 503])("retains actual HTTP status %i without trusting payload status", async (status) => {
    expect((await readApiProblem(Response.json({ status: 200, detail: "secret" }, { status }))).status).toBe(status);
  });
  it("bounds streamed body reads and rejects excessive input", async () => {
    await expect(readBoundedText(new Response("a".repeat(20)), 10)).rejects.toMatchObject({ problem: { status: 413 } });
  });
});

describe("expected results and framework flow", () => {
  it("returns expected sanitized API failures", async () => {
    const result = await getApiResult(async () => { throw new ApiRequestError({ status: 404, detail: "secret" }); });
    expect(result).toEqual({ ok: false, problem: safeProblem(404) });
  });
  it("returns genuine missing values but rethrows programming errors", async () => {
    await expect(getApiResult(async () => null)).resolves.toEqual({ ok: true, data: null });
    const error = new TypeError("application bug");
    await expect(getApiResult(async () => { throw error; })).rejects.toBe(error);
  });
  it("preserves Next notFound control flow", async () => {
    await expect(getApiResult(async () => notFound())).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
