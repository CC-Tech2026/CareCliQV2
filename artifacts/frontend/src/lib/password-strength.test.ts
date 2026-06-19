import { describe, expect, it } from "vitest";
import { passwordStrengthScore, validatePasswordPolicy } from "@/lib/password-strength";

describe("validatePasswordPolicy", () => {
  it("enforces minimum length and complexity", () => {
    expect(validatePasswordPolicy("short1A")).toContain("8 characters");
    expect(validatePasswordPolicy("password1")).toContain("uppercase");
    expect(validatePasswordPolicy("Password")).toContain("number");
  });

  it("accepts strong passwords", () => {
    expect(validatePasswordPolicy("SecurePass9")).toBeNull();
  });
});

describe("passwordStrengthScore", () => {
  it("scores stronger passwords higher", () => {
    expect(passwordStrengthScore("SecurePass9!")).toBeGreaterThan(passwordStrengthScore("Secure1"));
  });
});
