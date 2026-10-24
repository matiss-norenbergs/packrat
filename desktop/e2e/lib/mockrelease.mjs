// A stand-in for the GitHub Releases the "Match server version" command talks to (the debug build
// honours PACKRAT_UPDATE_BASE_URL). `/v<version>/latest.json` offers `offers[version]`; the
// installer URL serves a few junk bytes, so installing fails at the signature check, as it should.
import http from "node:http"

export async function startMockRelease(offers) {
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`
    const match = /^\/v([0-9.]+)\/latest\.json$/.exec(req.url)
    if (match && offers[match[1]]) {
      const platform = { url: `${base}/pkg`, signature: "bm90IGEgc2lnbmF0dXJl" }
      const manifest = {
        version: offers[match[1]],
        notes: "e2e",
        pub_date: "2026-01-01T00:00:00Z",
        platforms: { "linux-x86_64": platform, "windows-x86_64": platform },
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest))
    } else if (req.url === "/pkg") {
      res.writeHead(200, { "content-type": "application/octet-stream" }).end("junk")
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() }
}
