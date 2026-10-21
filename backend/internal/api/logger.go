package api

import (
	"fmt"
	"regexp"

	"github.com/gin-gonic/gin"
)

// tokenQueryParam matches the session token a desktop client puts in the query string of media/
// image/WebSocket URLs (see sessionCandidates).
var tokenQueryParam = regexp.MustCompile(`([?&]token=)[^&\s]*`)

// redactToken masks a ?token= query value so a session credential never lands in the access log.
func redactToken(path string) string {
	return tokenQueryParam.ReplaceAllString(path, "${1}REDACTED")
}

// redactingLogFormatter is gin's default access-log line with the request path run through
// redactToken.
func redactingLogFormatter(p gin.LogFormatterParams) string {
	return fmt.Sprintf("[GIN] %v |%s %3d %s| %13v | %15s |%s %-7s %s %#v\n%s",
		p.TimeStamp.Format("2006/01/02 - 15:04:05"),
		p.StatusCodeColor(), p.StatusCode, p.ResetColor(),
		p.Latency,
		p.ClientIP,
		p.MethodColor(), p.Method, p.ResetColor(),
		redactToken(p.Path),
		p.ErrorMessage,
	)
}
