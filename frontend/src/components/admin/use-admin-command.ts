"use client";

import { useRef, useState } from "react";
import { commerceMutation } from "@/lib/api/client";
import { ApiRequestError } from "@/lib/api/errors";
import type { ApiProblem } from "@/types/api";

type Attempt = { path: `Admin/${string}`; body: unknown; key: string };

export function useAdminCommand<T>(staffId: string, decode: (value: unknown) => T) {
  const lock = useRef(false);
  const activeAttempt = useRef<Attempt | null>(null);
  const appliedRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [applied, setApplied] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [uncertain, setUncertain] = useState(false);

  async function send(attempt: Attempt): Promise<T | undefined> {
    if (lock.current || appliedRef.current) return;
    lock.current = true;
    activeAttempt.current = attempt;
    setPending(true);
    setProblem(null);
    try {
      const data = await commerceMutation(attempt.path, attempt.body, decode, {
        mode: "live", idempotencyKey: attempt.key, expectedOwner: "account", expectedAccountId: staffId,
      });
      appliedRef.current = true;
      setApplied(true);
      setUncertain(false);
      return data;
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setProblem(error.problem);
        const unknownResult = !error.problem.status || error.problem.status >= 500;
        setUncertain(unknownResult);
        if (!unknownResult) activeAttempt.current = null;
      } else setUncertain(true);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  async function run(path: `Admin/${string}`, body: unknown) {
    if (activeAttempt.current || lock.current || appliedRef.current || problem?.status === 409 || problem?.status === 401 || problem?.status === 403) return;
    return send({ path, body, key: crypto.randomUUID() });
  }

  async function retry() {
    if (!uncertain || !activeAttempt.current) return;
    // Keep the exact payload and key in memory; a retry fetches a fresh CSRF token.
    return send(activeAttempt.current);
  }

  return {
    run, retry, pending, applied, problem, uncertain,
    blocked: pending || applied || uncertain || problem?.status === 409 || problem?.status === 401 || problem?.status === 403,
  };
}
