package api

import (
	"io"
	"os"
	"regexp"

	"github.com/gin-gonic/gin"
)

// credentialHeaderLine matches a request-dump header line that carries a credential. gin's own
// dump only masks Authorization; the session/CSRF cookies and the CSRF header are just as secret.
var credentialHeaderLine = regexp.MustCompile(`(?mi)^((?:Proxy-)?Authorization|Cookie|Set-Cookie|X-CSRF-Token):.*$`)

// redactDump masks everything a panic log can carry that is a credential: the ?token= query
// value (via redactToken, same as the access log) and the auth/cookie/CSRF header lines.
func redactDump(s string) string {
	return credentialHeaderLine.ReplaceAllString(redactToken(s), "${1}: *")
}

// redactingWriter redacts each write. gin's recovery logs a whole panic report per Printf call,
// so a write is never split mid-line.
type redactingWriter struct{ w io.Writer }

func (r redactingWriter) Write(p []byte) (int, error) {
	if _, err := io.WriteString(r.w, redactDump(string(p))); err != nil {
		return 0, err
	}
	return len(p), nil
}

// recoveryWriter is gin.Recovery() writing to out with credentials redacted. In debug mode (the
// default — GIN_MODE is not set) gin dumps the request on a panic, including the raw request line
// and Cookie header. The client still gets the same empty 500.
func recoveryWriter(out io.Writer) gin.HandlerFunc {
	return gin.RecoveryWithWriter(redactingWriter{out})
}

// recovery is the router's panic handler, logging to stderr like gin.Recovery().
func recovery() gin.HandlerFunc {
	if gin.DefaultErrorWriter != nil {
		return recoveryWriter(gin.DefaultErrorWriter)
	}
	return recoveryWriter(os.Stderr)
}
