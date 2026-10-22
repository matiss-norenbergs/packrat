import { describe, expect, it } from "vitest"
import { compareSemver, parseSemver, serverNewerThanApp } from "@/lib/semver"

describe("parseSemver", () => {
  it("accepts versions with an optional v, pre-release and build", () => {
    expect(parseSemver("1.2.3")?.core).toEqual([1, 2, 3])
    expect(parseSemver("v1.2.3")?.core).toEqual([1, 2, 3])
    expect(parseSemver("1.2.3-rc.1+abc")?.pre).toEqual(["rc", "1"])
  })

  it("rejects anything else", () => {
    for (const bad of ["dev", "", "1.2", "1.2.x", "latest", null, undefined]) expect(parseSemver(bad)).toBeNull()
  })
})

describe("compareSemver", () => {
  it("orders by major, minor, then patch numerically", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0)
    expect(compareSemver("1.2.4", "1.2.3")).toBe(1)
    expect(compareSemver("1.10.0", "1.9.9")).toBe(1)
    expect(compareSemver("2.0.0", "10.0.0")).toBe(-1)
  })

  it("ranks a pre-release below its release", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1)
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1)
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1)
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1)
  })

  it("is null when a side is not a version", () => {
    expect(compareSemver("dev", "1.0.0")).toBeNull()
  })
})

describe("serverNewerThanApp", () => {
  it("is true only for a strictly newer valid server", () => {
    expect(serverNewerThanApp("1.3.0", "1.2.0")).toBe(true)
    expect(serverNewerThanApp("1.2.0", "1.2.0")).toBe(false)
    expect(serverNewerThanApp("1.1.0", "1.2.0")).toBe(false)
    expect(serverNewerThanApp("dev", "0.1.0")).toBe(false)
    expect(serverNewerThanApp("1.0.0", "garbage")).toBe(false)
    expect(serverNewerThanApp("1.0.0", null)).toBe(false)
  })
})
