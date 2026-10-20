import { notFound } from "next/navigation";
import { describe, expect, it } from "vitest";
import { ApiRequestError, getApiResult, readApiProblem } from "@/lib/api/errors";

const url = "http://localhost:5249/api/v1/Product";

describe("readApiProblem", () => {
  it("keeps ProblemDetails and validation messages with the real HTTP status", async () => {
    const response = Response.json(
      {
        title: "Invalid request",
        detail: "The product name is required.",
        status: 500,
        type: "https://example.com/problems/validation",
        traceId: "request-123",
        errors: { productName: ["Name is required."], ignored: [null, 42] },
        stack: "private stack trace",
      },
      { status: 400 },
    );

    expect(await readApiProblem(response, url)).toEqual({
      title: "Invalid request",
      detail: "The product name is required.",
      status: 400,
      method: "GET",
      url,
      type: "https://example.com/problems/validation",
      traceId: "request-123",
      errors: { productName: ["Name is required."] },
    });
  });

  it.each([404, 405, 429, 500, 503])(
    "handles HTTP %i with an empty body and status text",
    async (status) => {
      const problem = await readApiProblem(new Response(null, { status }), url);
      expect(problem.status).toBe(status);
      expect(problem.title).toBe("API request failed");
      expect(problem.detail).toBe(`GET ${url} failed with ${status}.`);
    },
  );

  it.each([
    [
      { message: "The backend rejected this request." },
      "The backend rejected this request.",
    ],
    [{ error: "Database is offline." }, "Database is offline."],
    ["No such route.", "No such route."],
  ])(
    "accepts JSON message, error, and string responses: %j",
    async (body, detail) => {
      expect(await readApiProblem(Response.json(body, { status: 404 }), url))
        .toMatchObject({ status: 404, detail });
    },
  );

  it("uses the first plain-text line without including a stack trace", async () => {
    const response = new Response(
      "Database unavailable\n    at Controller.GetProducts()",
      { status: 503 },
    );
    expect(await readApiProblem(response, url)).toMatchObject({
      detail: "Database unavailable",
    });
  });

  it("does not render an HTML error page or its scripts", async () => {
    const response = new Response(
      "<!doctype html><html><body>secret<script>alert(1)</script></body></html>",
      { status: 502 },
    );
    const problem = await readApiProblem(response, url);
    expect(problem.detail).toContain("HTML error page instead of JSON");
    expect(JSON.stringify(problem)).not.toContain("secret");
    expect(JSON.stringify(problem)).not.toContain("<script>");
  });

  it("keeps HTTP details when reading the body fails", async () => {
    const response = new Response(null, { status: 503 });
    response.text = async () => {
      throw new Error("Body disconnected");
    };
    expect(await readApiProblem(response, url)).toMatchObject({
      status: 503,
      detail: `GET ${url} failed with 503.`,
    });
  });

  it("bounds long messages and ignores other backend exception fields", async () => {
    const problem = await readApiProblem(
      Response.json({
        detail: "a".repeat(5000),
        exception: "secret exception",
        stackTrace: "private trace",
      }, { status: 500 }),
      url,
    );
    expect(problem.detail).toHaveLength(2003);
    expect(problem.detail.endsWith("...")).toBe(true);
    expect(JSON.stringify(problem)).not.toContain("secret");
    expect(JSON.stringify(problem)).not.toContain("private");
  });
});

describe("getApiResult", () => {
  it("returns successful values, including a genuine missing product", async () => {
    await expect(getApiResult(async () => null)).resolves.toEqual({
      ok: true,
      data: null,
    });
  });

  it("returns a serializable expected problem instead of an uncaught exception", async () => {
    const problem = {
      title: "Not Found",
      detail: "The API route does not exist.",
      status: 404,
    };
    const result = await getApiResult(async () => {
      throw new ApiRequestError(problem);
    });
    expect(result).toEqual({ ok: false, problem });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("does not disguise unexpected programming errors as API failures", async () => {
    const error = new TypeError("Unexpected page bug");
    await expect(getApiResult(async () => {
      throw error;
    })).rejects.toBe(error);
  });

  it("preserves Next.js notFound control flow", async () => {
    await expect(getApiResult(async () => notFound()))
      .rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
