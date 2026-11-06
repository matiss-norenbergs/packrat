package downloader

import (
	"regexp"
	"strings"
)

// redacted replaces a credential or private path in a logged command line.
const redacted = "REDACTED"

// urlUserinfo matches the "user:pass@" part of a URL-looking string.
var urlUserinfo = regexp.MustCompile(`([A-Za-z][A-Za-z0-9+.-]*://)[^/\s@]+@`)

// proxyUserinfo matches a leading "user:pass@" on a scheme-less proxy value.
var proxyUserinfo = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9+.-]*://)?[^/@\s]+@`)

// RedactText masks "user:pass@" credentials inside any URL found in s. It is safe to run on
// stdout/stderr tails and error messages as well as command lines.
func RedactText(s string) string {
	return urlUserinfo.ReplaceAllString(s, "${1}"+redacted+"@")
}

func redactProxyValue(v string) string {
	if m := proxyUserinfo.FindStringSubmatch(v); m != nil {
		return m[1] + redacted + "@" + v[len(m[0]):]
	}
	return v
}

// RedactArgs returns a copy of args that is safe to store or display: the credentials of any
// URL-looking argument and of the --proxy value are masked, and the --cookies path is hidden.
func RedactArgs(args []string) []string {
	out := make([]string, len(args))
	for i, a := range args {
		switch {
		case i > 0 && args[i-1] == "--cookies":
			out[i] = redacted
		case i > 0 && args[i-1] == "--proxy":
			out[i] = RedactText(redactProxyValue(a))
		case strings.HasPrefix(a, "--proxy="):
			out[i] = "--proxy=" + RedactText(redactProxyValue(strings.TrimPrefix(a, "--proxy=")))
		case strings.HasPrefix(a, "--cookies="):
			out[i] = "--cookies=" + redacted
		default:
			out[i] = RedactText(a)
		}
	}
	return out
}

var (
	cmdProxyFlag   = regexp.MustCompile(`(--proxy[ =])(\S+)`)
	cmdCookiesFlag = regexp.MustCompile(`(--cookies[ =])(\S+)`)
)

// RedactCommand applies the same masking to an already-joined command line (rows stored before
// the command was redacted at build time). Whitespace inside a cookies path ends the match, which
// only under-redacts the tail of such a path, never leaks the credential-bearing proxy value.
func RedactCommand(cmd string) string {
	cmd = cmdProxyFlag.ReplaceAllStringFunc(cmd, func(m string) string {
		sub := cmdProxyFlag.FindStringSubmatch(m)
		return sub[1] + redactProxyValue(sub[2])
	})
	cmd = cmdCookiesFlag.ReplaceAllString(cmd, "${1}"+redacted)
	return RedactText(cmd)
}
