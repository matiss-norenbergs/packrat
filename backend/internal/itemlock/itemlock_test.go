package itemlock

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMutualExclusionPerKey(t *testing.T) {
	l := New()
	var inside, maxInside int32
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				l.Lock(1)
				n := atomic.AddInt32(&inside, 1)
				if n > atomic.LoadInt32(&maxInside) {
					atomic.StoreInt32(&maxInside, n)
				}
				atomic.AddInt32(&inside, -1)
				l.Unlock(1)
			}
		}()
	}
	wg.Wait()
	if maxInside != 1 {
		t.Fatalf("max concurrent holders = %d, want 1", maxInside)
	}
	if l.Len() != 0 {
		t.Fatalf("entries left = %d, want 0", l.Len())
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l := New()
	l.Lock(1)
	defer l.Unlock(1)
	if !l.TryLock(2) {
		t.Fatal("lock on a different key should not be blocked")
	}
	l.Unlock(2)
}

func TestTryLock(t *testing.T) {
	l := New()
	if !l.TryLock(1) {
		t.Fatal("TryLock on a free key failed")
	}
	if l.TryLock(1) {
		t.Fatal("TryLock on a held key succeeded")
	}
	l.Unlock(1)
	if !l.TryLock(1) {
		t.Fatal("TryLock after Unlock failed")
	}
	l.Unlock(1)
}

func TestLockBlocksUntilUnlock(t *testing.T) {
	l := New()
	l.Lock(1)
	got := make(chan struct{})
	go func() {
		l.Lock(1)
		close(got)
		l.Unlock(1)
	}()
	select {
	case <-got:
		t.Fatal("Lock returned while held")
	case <-time.After(50 * time.Millisecond):
	}
	l.Unlock(1)
	select {
	case <-got:
	case <-time.After(2 * time.Second):
		t.Fatal("waiter never acquired the lock")
	}
	deadline := time.Now().Add(2 * time.Second)
	for l.Len() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if l.Len() != 0 {
		t.Fatalf("entries left = %d, want 0", l.Len())
	}
}

func TestEntriesCleanedUp(t *testing.T) {
	l := New()
	for i := int64(0); i < 100; i++ {
		l.Lock(i)
		l.Unlock(i)
		if l.TryLock(i) {
			l.Unlock(i)
		}
	}
	if l.Len() != 0 {
		t.Fatalf("entries left = %d, want 0", l.Len())
	}
}

func TestUnlockUnlockedPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	New().Unlock(1)
}

func TestTryLockAll(t *testing.T) {
	l := New()
	l.Lock(2)
	release, ok := l.TryLockAll([]int64{1, 2, 3})
	if ok {
		t.Fatal("TryLockAll should fail when one id is held")
	}
	release()
	// 1 and 3 must not have stayed locked.
	if !l.TryLock(1) || !l.TryLock(3) {
		t.Fatal("failed TryLockAll leaked locks")
	}
	l.Unlock(1)
	l.Unlock(3)
	l.Unlock(2)

	release, ok = l.TryLockAll([]int64{1, 1, 2})
	if !ok {
		t.Fatal("TryLockAll on free ids failed")
	}
	if l.TryLock(1) || l.TryLock(2) {
		t.Fatal("ids should be held")
	}
	release()
	if l.Len() != 0 {
		t.Fatalf("entries left = %d, want 0", l.Len())
	}
}
