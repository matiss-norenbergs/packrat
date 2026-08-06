// Package version holds Packrat's own release version.
package version

// Version is set at build time via
// -ldflags "-X packrat/backend/internal/version.Version=X.Y.Z" from the
// pushed git tag (see .github/workflows/release.yml and docker/Dockerfile's
// VERSION build-arg). Local/dev builds that skip that flag report "dev".
var Version = "dev"
