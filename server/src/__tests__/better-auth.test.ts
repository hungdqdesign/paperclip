import { afterEach, describe, expect, it } from "vitest";
import { MISSING_BETTER_AUTH_SECRET_MESSAGE, requireBetterAuthSecret } from "../auth/better-auth.ts";

const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
const originalAgentJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;

afterEach(() => {
  if (originalBetterAuthSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
  }

  if (originalAgentJwtSecret === undefined) {
    delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
  } else {
    process.env.PAPERCLIP_AGENT_JWT_SECRET = originalAgentJwtSecret;
  }
});

describe("requireBetterAuthSecret", () => {
  it("throws when neither auth secret environment variable is set", () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.PAPERCLIP_AGENT_JWT_SECRET;

    expect(() => requireBetterAuthSecret()).toThrow(MISSING_BETTER_AUTH_SECRET_MESSAGE);
  });

  it("prefers BETTER_AUTH_SECRET when present", () => {
    process.env.BETTER_AUTH_SECRET = "primary-secret";
    process.env.PAPERCLIP_AGENT_JWT_SECRET = "secondary-secret";

    expect(requireBetterAuthSecret()).toBe("primary-secret");
  });

  it("falls back to PAPERCLIP_AGENT_JWT_SECRET when BETTER_AUTH_SECRET is absent", () => {
    delete process.env.BETTER_AUTH_SECRET;
    process.env.PAPERCLIP_AGENT_JWT_SECRET = "secondary-secret";

    expect(requireBetterAuthSecret()).toBe("secondary-secret");
  });
});
