/**
 * Tests for BuildInfo interface and mock factory.
 */

import { describe, it, expect } from "vitest";
import { createMockBuildInfo } from "./build-info.test-utils";
import type { BuildInfo } from "./build-info";

describe("createMockBuildInfo", () => {
  it("returns isDevelopment: true by default", () => {
    const buildInfo = createMockBuildInfo();

    expect(buildInfo.isDevelopment).toBe(true);
  });

  it("returns gitBranch: 'test-branch' by default in dev mode", () => {
    const buildInfo = createMockBuildInfo();

    expect(buildInfo.gitBranch).toBe("test-branch");
  });

  it("accepts override for isDevelopment", () => {
    const buildInfo = createMockBuildInfo({ isDevelopment: false });

    expect(buildInfo.isDevelopment).toBe(false);
  });

  it("returns undefined gitBranch when isDevelopment is false", () => {
    const buildInfo = createMockBuildInfo({ isDevelopment: false });

    expect(buildInfo.gitBranch).toBeUndefined();
  });

  it("accepts override for gitBranch", () => {
    const buildInfo = createMockBuildInfo({ gitBranch: "feature/my-branch" });

    expect(buildInfo.gitBranch).toBe("feature/my-branch");
  });

  it("returns object satisfying BuildInfo interface", () => {
    const buildInfo: BuildInfo = createMockBuildInfo();

    // TypeScript ensures type compatibility at compile time
    // This test verifies the interface is implemented correctly
    expect(buildInfo).toHaveProperty("isDevelopment");
    expect(typeof buildInfo.isDevelopment).toBe("boolean");
  });
});
