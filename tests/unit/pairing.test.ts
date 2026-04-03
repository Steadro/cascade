import { describe, it, expect } from "vitest";
import { normalizeDomain } from "../../app/utils/pairing.server";

describe("normalizeDomain", () => {
  it("passes through a valid myshopify.com domain unchanged", () => {
    expect(normalizeDomain("my-store.myshopify.com")).toBe(
      "my-store.myshopify.com",
    );
  });

  it("lowercases the domain", () => {
    expect(normalizeDomain("MY-STORE.MYSHOPIFY.COM")).toBe(
      "my-store.myshopify.com",
    );
  });

  it("strips https:// and trailing slash", () => {
    expect(normalizeDomain("https://my-store.myshopify.com/")).toBe(
      "my-store.myshopify.com",
    );
  });

  it("strips http://", () => {
    expect(normalizeDomain("http://my-store.myshopify.com")).toBe(
      "my-store.myshopify.com",
    );
  });

  it("appends .myshopify.com when missing", () => {
    expect(normalizeDomain("my-store")).toBe("my-store.myshopify.com");
  });

  it("trims whitespace", () => {
    expect(normalizeDomain("   my-store   ")).toBe("my-store.myshopify.com");
  });

  it("throws on empty input", () => {
    expect(() => normalizeDomain("")).toThrow("Store domain is required");
  });

  it("throws on whitespace-only input", () => {
    expect(() => normalizeDomain("   ")).toThrow("Store domain is required");
  });

  it("throws on domain with spaces", () => {
    expect(() => normalizeDomain("has spaces.myshopify.com")).toThrow(
      "Invalid store domain",
    );
  });

  it("throws on domain with special characters", () => {
    expect(() => normalizeDomain("not-valid!!")).toThrow(
      "Invalid store domain",
    );
  });

  it("throws on domain starting with hyphen", () => {
    expect(() => normalizeDomain("-invalid.myshopify.com")).toThrow(
      "Invalid store domain",
    );
  });

  it("accepts domains with numbers", () => {
    expect(normalizeDomain("store123.myshopify.com")).toBe(
      "store123.myshopify.com",
    );
  });

  it("accepts domains starting with numbers", () => {
    expect(normalizeDomain("123store.myshopify.com")).toBe(
      "123store.myshopify.com",
    );
  });
});
