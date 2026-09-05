import { describe, expect, it } from "vitest";
import {
  WORKER_PROTOCOL_VERSION,
  isWorkerResponse,
  type WorkerResponse,
} from "../../src/workers/protocol";

describe("worker protocol", () => {
  it("accepts a versioned progress response", () => {
    const response: WorkerResponse = {
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: "job-1",
      stage: "validating",
      progress: 0.4,
      message: "validating",
    };
    expect(isWorkerResponse(response)).toBe(true);
  });

  it("rejects stale and malformed envelopes", () => {
    expect(isWorkerResponse({ version: 1, type: "job.progress", jobId: "x" })).toBe(false);
    expect(isWorkerResponse({ version: 2, type: "job.progress", jobId: "stale" })).toBe(false);
    expect(isWorkerResponse({ version: 3, type: "job.progress", jobId: "stale" })).toBe(false);
    expect(isWorkerResponse({ version: 4, type: "job.progress", jobId: "stale" })).toBe(false);
    expect(isWorkerResponse({ version: 5, type: "job.progress", jobId: "stale" })).toBe(false);
    expect(isWorkerResponse({ version: 6, type: "job.progress" })).toBe(false);
    expect(isWorkerResponse({ version: 7, type: "job.progress", jobId: "stale" })).toBe(false);
    expect(isWorkerResponse({ version: 8, type: "job.progress", jobId: "stale" })).toBe(false);
    expect(isWorkerResponse(null)).toBe(false);
  });
});
