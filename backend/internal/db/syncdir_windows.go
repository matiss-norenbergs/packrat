//go:build windows

package db

// syncDir is a no-op on Windows (directories cannot be opened for fsync).
func syncDir(string) {}
