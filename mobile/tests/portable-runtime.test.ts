import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { sdk } from "../server/_core/sdk";
import { storageGet, storagePut } from "../server/storage";

describe("portable runtime adapters", () => {
  beforeEach(() => {
    fs.rmSync(path.join(process.cwd(), "server", "uploads"), { recursive: true, force: true });
  });

  it("creates and verifies a local JWT session without a hosted auth service", async () => {
    const token = await sdk.createSessionToken("portable-user", {
      name: "Portable User",
      email: "portable@example.com",
      role: "admin",
    });

    const session = await sdk.verifySession(token);
    expect(session?.openId).toBe("portable-user");
    expect(session?.role).toBe("admin");
    expect(session?.email).toBe("portable@example.com");
  });

  it("stores uploaded assets on the local filesystem and returns portable URLs", async () => {
    const upload = await storagePut("permits/sample.txt", "portable content", "text/plain");
    expect(upload.url).toContain("/uploads/");

    const storedPath = path.join(process.cwd(), "server", "uploads", upload.key);
    expect(fs.existsSync(storedPath)).toBe(true);

    const retrieved = await storageGet(upload.key);
    expect(retrieved.url).toContain(upload.key);
  });
});
