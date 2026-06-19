import { describe, expect, it } from "vitest";
import { validateLoginIdentifier } from "@/lib/auth-login-validation";

describe("validateLoginIdentifier", () => {
  it("requires a value", () => {
    expect(validateLoginIdentifier("")).toBe("Enter your email or mobile number");
  });

  it("validates email format before submit", () => {
    expect(validateLoginIdentifier("not-an-email")).toBe("Enter a valid mobile number");
    expect(validateLoginIdentifier("bad@")).toBe("Enter a valid email address");
  });

  it("accepts valid email", () => {
    expect(validateLoginIdentifier("worker@example.com")).toBeNull();
  });

  it("accepts valid mobile numbers", () => {
    expect(validateLoginIdentifier("0412 345 678")).toBeNull();
    expect(validateLoginIdentifier("+61412345678")).toBeNull();
  });
});
