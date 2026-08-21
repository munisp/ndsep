import { describe, it, expect } from "vitest";
import { COOKIE_NAME } from "../shared/const";

describe("const test", () => {
  it("COOKIE_NAME is defined", () => {
    expect(COOKIE_NAME).toBe("app_session_id");
  });
});
