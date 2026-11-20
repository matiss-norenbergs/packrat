package downloader

import "testing"

func TestTrimPreviewNameRoundTrip(t *testing.T) {
	for _, base := range []string{"vid", "a.trim-preview-9-x", "weird-name.1", "v-1-2"} {
		name := trimPreviewName(base, 42, "k3j2h", ".mp4")
		id, ok := TrimPreviewItemID(name)
		if !ok || id != 42 {
			t.Errorf("TrimPreviewItemID(%q) = %d, %v; want 42, true", name, id, ok)
		}
	}
	for _, bad := range []string{
		"vid.mp4", "vid.trim-preview-abc.mp4", "vid.trim-preview-abc-def.mp4", "vid.trim-preview-.mp4",
		"vid.trim-preview-0-x.mp4", "vid.trim-preview--5-x.mp4", "vid.trim-preview-7-", "vid.trim-preview-7",
	} {
		if id, ok := TrimPreviewItemID(bad); ok {
			t.Errorf("TrimPreviewItemID(%q) = %d, true; want not ok", bad, id)
		}
	}
}
