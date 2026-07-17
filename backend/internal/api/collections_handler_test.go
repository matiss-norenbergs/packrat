package api

import (
	"testing"

	"packrat/backend/internal/models"
)

func TestSortDeepestFirst(t *testing.T) {
	root := int64(1)
	child := int64(2)
	grandchild := int64(3)
	unrelated := int64(4)

	all := []models.Collection{
		{ID: root, ParentID: nil},
		{ID: child, ParentID: &root},
		{ID: grandchild, ParentID: &child},
		{ID: unrelated, ParentID: nil},
	}

	t.Run("orders deepest first regardless of input order", func(t *testing.T) {
		got := sortDeepestFirst([]int64{root, grandchild, child}, all)
		if len(got) != 3 || got[0] != grandchild || got[1] != child || got[2] != root {
			t.Fatalf("expected [grandchild, child, root], got %v", got)
		}
	})

	t.Run("ties (same depth) keep a stable relative order", func(t *testing.T) {
		got := sortDeepestFirst([]int64{root, unrelated}, all)
		if len(got) != 2 || got[0] != root || got[1] != unrelated {
			t.Fatalf("expected [root, unrelated] unchanged (both depth 0), got %v", got)
		}
	})

	t.Run("an id not present in all is treated as depth 0", func(t *testing.T) {
		got := sortDeepestFirst([]int64{grandchild, 999}, all)
		if len(got) != 2 || got[0] != grandchild || got[1] != 999 {
			t.Fatalf("expected [grandchild, 999], got %v", got)
		}
	})

	t.Run("does not mutate the input slice", func(t *testing.T) {
		input := []int64{root, grandchild, child}
		_ = sortDeepestFirst(input, all)
		if input[0] != root || input[1] != grandchild || input[2] != child {
			t.Fatalf("expected input slice unchanged, got %v", input)
		}
	})
}
