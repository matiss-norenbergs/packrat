package api

import (
	"reflect"
	"testing"
)

func TestNormalizeDashboardWidgetIDs(t *testing.T) {
	t.Run("keeps known ids in order and drops duplicates", func(t *testing.T) {
		valid, unknown := normalizeDashboardWidgetIDs([]string{"storage", "topTags", "storage"})
		if !reflect.DeepEqual(valid, []string{"storage", "topTags"}) {
			t.Fatalf("expected [storage topTags], got %v", valid)
		}
		if len(unknown) != 0 {
			t.Fatalf("expected no unknown ids, got %v", unknown)
		}
	})

	t.Run("reports unknown ids", func(t *testing.T) {
		valid, unknown := normalizeDashboardWidgetIDs([]string{"storage", "bogus"})
		if !reflect.DeepEqual(valid, []string{"storage"}) {
			t.Fatalf("expected [storage], got %v", valid)
		}
		if !reflect.DeepEqual(unknown, []string{"bogus"}) {
			t.Fatalf("expected [bogus] unknown, got %v", unknown)
		}
	})

	t.Run("empty input yields a non-nil empty list", func(t *testing.T) {
		valid, _ := normalizeDashboardWidgetIDs(nil)
		if valid == nil || len(valid) != 0 {
			t.Fatalf("expected empty non-nil slice, got %#v", valid)
		}
	})
}
