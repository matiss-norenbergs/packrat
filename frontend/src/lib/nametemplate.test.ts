import { describe, expect, it } from "vitest"
import { parseTemplate, resolveFilenameTemplatePreview, serializeTemplate } from "./nametemplate"

describe("resolveFilenameTemplatePreview", () => {
  it("returns empty for a blank template", () => {
    expect(resolveFilenameTemplatePreview("   ", {})).toBe("")
  })

  it("substitutes a known field", () => {
    expect(resolveFilenameTemplatePreview("{title}", { title: "My Video" })).toBe("My Video")
  })

  it("substitutes a missing field with empty text, trimming the trailing result", () => {
    expect(resolveFilenameTemplatePreview("{title} - {artist}", { title: "My Video" })).toBe("My Video -")
  })

  it("splits on '/' into separate segments joined with ' / ', dropping empty segments", () => {
    expect(resolveFilenameTemplatePreview("{collection}/{title}", { collection: "Show", title: "Ep1" })).toBe(
      "Show / Ep1",
    )
    expect(resolveFilenameTemplatePreview("{collection}/{title}", { title: "Ep1" })).toBe("Ep1")
  })

  it("zero-pads a numeric field via a numeric modifier", () => {
    expect(resolveFilenameTemplatePreview("{season:2}", { season: "3" })).toBe("03")
  })

  it("leaves a numeric modifier's target untouched when the value is empty", () => {
    expect(resolveFilenameTemplatePreview("{season:2}", {})).toBe("")
  })

  it("word-joins a text field via a non-numeric modifier", () => {
    expect(resolveFilenameTemplatePreview("{title:_}", { title: "My Cool Video" })).toBe("My_Cool_Video")
  })

  it("resolves 'channel' as an alias for uploader", () => {
    expect(resolveFilenameTemplatePreview("{channel}", { uploader: "Some Channel" })).toBe("Some Channel")
  })

  it("leaves an unrecognized token as literal text", () => {
    expect(resolveFilenameTemplatePreview("{unknown}", {})).toBe("{unknown}")
  })
})

describe("parseTemplate / serializeTemplate round-trip", () => {
  const templates = [
    "{title} - {artist}",
    "{season:2}",
    "just literal text",
    "{collection}/{season}/{title:3}",
    "",
    "{title}{artist}",
  ]

  it.each(templates)("serializeTemplate(parseTemplate(%j)) reproduces the original", (template) => {
    expect(serializeTemplate(parseTemplate(template))).toBe(template)
  })

  it("splits a mixed template into alternating literal/token elements", () => {
    const elements = parseTemplate("{title} - {artist}")
    expect(elements).toHaveLength(3)
    expect(elements[0]).toMatchObject({ kind: "token", field: "title", modifier: "" })
    expect(elements[1]).toMatchObject({ kind: "literal", text: " - " })
    expect(elements[2]).toMatchObject({ kind: "token", field: "artist", modifier: "" })
  })

  it("captures a token's modifier", () => {
    const [element] = parseTemplate("{season:2}")
    expect(element).toMatchObject({ kind: "token", field: "season", modifier: "2" })
  })

  it("parses an empty template as no elements", () => {
    expect(parseTemplate("")).toEqual([])
  })

  it("assigns every element a unique id", () => {
    const elements = parseTemplate("{title} - {artist} - {year}")
    const ids = elements.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
