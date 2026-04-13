import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { actorMiddleware } from "../middleware/auth.js";

function createApp(resolveSession: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(
    actorMiddleware({} as never, {
      deploymentMode: "authenticated",
      resolveSession,
    }),
  );
  app.get("/", (_req, res) => {
    res.status(200).send("ok");
  });
  app.get("/api/ping", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("actorMiddleware", () => {
  it("skips session resolution for non-api page requests", async () => {
    const resolveSession = vi.fn(async () => null);
    const app = createApp(resolveSession);

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("still resolves sessions for api requests", async () => {
    const resolveSession = vi.fn(async () => null);
    const app = createApp(resolveSession);

    const res = await request(app).get("/api/ping");

    expect(res.status).toBe(200);
    expect(resolveSession).toHaveBeenCalledOnce();
  });
});
