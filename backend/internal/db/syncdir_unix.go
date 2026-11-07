//go:build !windows

package db

import "os"

// syncDir flushes the directory entry of a renamed file (best effort).
func syncDir(dir string) {
	if d, err := os.Open(dir); err == nil {
		d.Sync()
		d.Close()
	}
}
