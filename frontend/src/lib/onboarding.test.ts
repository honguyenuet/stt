import { describe, expect, it } from "vitest";
import type { User } from "@/context/AuthContext";
import {
  isOnboardingProtectedPath,
  needsOnboarding,
} from "./onboarding";

const user: User = {
  id: 1,
  firstName: "Hồ",
  lastName: "Mạnh",
  email: "user@example.com",
  avatar: null,
};

describe("onboarding routing", () => {
  it("requires onboarding only when the backend explicitly marks it incomplete", () => {
    expect(needsOnboarding({ ...user, onboardingCompleted: false })).toBe(true);
    expect(needsOnboarding({ ...user, onboardingCompleted: true })).toBe(false);
    expect(needsOnboarding(user)).toBe(false);
  });

  it("protects workspace and transcript routes without blocking public pages", () => {
    expect(isOnboardingProtectedPath("/dashboard")).toBe(true);
    expect(isOnboardingProtectedPath("/transcript/42")).toBe(true);
    expect(isOnboardingProtectedPath("/pricing")).toBe(false);
    expect(isOnboardingProtectedPath("/")).toBe(false);
  });
});
