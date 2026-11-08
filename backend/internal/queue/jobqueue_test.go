package queue

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func popNow(t *testing.T, q *jobQueue) (int64, bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return q.Pop(ctx, nil)
}

func TestJobQueueFIFOAndLen(t *testing.T) {
	q := newJobQueue()
	if q.Len() != 0 {
		t.Fatalf("Len = %d, want 0", q.Len())
	}
	for i := int64(1); i <= 5; i++ {
		q.Push(i)
		if q.Len() != int(i) {
			t.Fatalf("Len after push %d = %d", i, q.Len())
		}
	}
	for want := int64(1); want <= 5; want++ {
		got, ok := popNow(t, q)
		if !ok || got != want {
			t.Fatalf("Pop = %d,%v, want %d", got, ok, want)
		}
		if q.Len() != int(5-want) {
			t.Fatalf("Len after pop = %d", q.Len())
		}
	}
}

// Push is a short append: 10,000 pushes with nobody consuming must not block.
func TestJobQueuePushNeverBlocks(t *testing.T) {
	q := newJobQueue()
	done := make(chan struct{})
	go func() {
		for i := int64(0); i < 10_000; i++ {
			q.Push(i)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Push blocked")
	}
	if q.Len() != 10_000 {
		t.Fatalf("Len = %d", q.Len())
	}
	// And order is preserved across the whole backlog.
	for want := int64(0); want < 10_000; want++ {
		if got, ok := popNow(t, q); !ok || got != want {
			t.Fatalf("Pop = %d,%v, want %d", got, ok, want)
		}
	}
}

func TestJobQueueRemove(t *testing.T) {
	q := newJobQueue()
	for _, id := range []int64{1, 2, 3, 4} {
		q.Push(id)
	}
	if !q.Remove(3) {
		t.Fatal("Remove(3) = false for a queued id")
	}
	if q.Remove(3) {
		t.Fatal("Remove(3) twice = true")
	}
	if q.Remove(99) {
		t.Fatal("Remove of unknown id = true")
	}
	if q.Len() != 3 {
		t.Fatalf("Len = %d, want 3", q.Len())
	}
	// A taken id is no longer removable.
	if got, _ := popNow(t, q); got != 1 {
		t.Fatalf("Pop = %d", got)
	}
	if q.Remove(1) {
		t.Fatal("Remove of an already-taken id = true")
	}
	// Remaining order is untouched.
	for _, want := range []int64{2, 4} {
		if got, ok := popNow(t, q); !ok || got != want {
			t.Fatalf("Pop = %d,%v, want %d", got, ok, want)
		}
	}
}

func TestJobQueueStopAndContextWakeWaiter(t *testing.T) {
	t.Run("stop channel", func(t *testing.T) {
		q := newJobQueue()
		stop := make(chan struct{})
		res := make(chan bool, 1)
		go func() { _, ok := q.Pop(context.Background(), stop); res <- ok }()
		time.Sleep(20 * time.Millisecond)
		close(stop)
		select {
		case ok := <-res:
			if ok {
				t.Fatal("Pop returned an item after stop")
			}
		case <-time.After(2 * time.Second):
			t.Fatal("waiter did not wake on stop")
		}
	})
	t.Run("context", func(t *testing.T) {
		q := newJobQueue()
		ctx, cancel := context.WithCancel(context.Background())
		res := make(chan bool, 1)
		go func() { _, ok := q.Pop(ctx, nil); res <- ok }()
		time.Sleep(20 * time.Millisecond)
		cancel()
		select {
		case ok := <-res:
			if ok {
				t.Fatal("Pop returned an item after cancel")
			}
		case <-time.After(2 * time.Second):
			t.Fatal("waiter did not wake on context cancel")
		}
	})
	t.Run("a stopped consumer leaves queued items alone", func(t *testing.T) {
		q := newJobQueue()
		q.Push(7)
		stop := make(chan struct{})
		close(stop)
		if _, ok := q.Pop(context.Background(), stop); ok {
			t.Fatal("stopped consumer took an item")
		}
		if q.Len() != 1 {
			t.Fatalf("Len = %d, want the item still queued", q.Len())
		}
	})
	t.Run("no stale waiter after leaving", func(t *testing.T) {
		q := newJobQueue()
		stop := make(chan struct{})
		res := make(chan bool, 1)
		go func() { _, ok := q.Pop(context.Background(), stop); res <- ok }()
		time.Sleep(20 * time.Millisecond)
		close(stop)
		<-res
		q.mu.Lock()
		n := len(q.waiters)
		q.mu.Unlock()
		if n != 0 {
			t.Fatalf("%d waiters left registered", n)
		}
	})
}

// N waiting consumers, M pushes: every id is delivered exactly once.
func TestJobQueueExactlyOnceDelivery(t *testing.T) {
	for _, tc := range []struct{ consumers, pushes int }{{4, 2}, {4, 4}, {4, 400}, {1, 50}, {16, 1000}} {
		q := newJobQueue()
		var mu sync.Mutex
		got := map[int64]int{}
		var wg sync.WaitGroup
		ctx, cancel := context.WithCancel(context.Background())
		for i := 0; i < tc.consumers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for {
					id, ok := q.Pop(ctx, nil)
					if !ok {
						return
					}
					mu.Lock()
					got[id]++
					mu.Unlock()
				}
			}()
		}
		time.Sleep(20 * time.Millisecond) // let every consumer park
		for i := 0; i < tc.pushes; i++ {
			q.Push(int64(i))
		}
		waitFor(t, "all pushed ids delivered", func() bool {
			mu.Lock()
			defer mu.Unlock()
			return len(got) == tc.pushes
		})
		cancel()
		wg.Wait()
		for id, n := range got {
			if n != 1 {
				t.Fatalf("%d consumers/%d pushes: id %d delivered %d times", tc.consumers, tc.pushes, id, n)
			}
		}
		if q.Len() != 0 {
			t.Fatalf("Len = %d after draining", q.Len())
		}
	}
}

// M pushes wake exactly min(N, M) of N parked consumers when they hold the item.
func TestJobQueueWakesMinOfWaitersAndPushes(t *testing.T) {
	const consumers = 5
	for _, pushes := range []int{1, 3, 5, 8} {
		q := newJobQueue()
		var took atomic.Int32
		release := make(chan struct{})
		ctx, cancel := context.WithCancel(context.Background())
		var wg sync.WaitGroup
		for i := 0; i < consumers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, ok := q.Pop(ctx, nil); ok {
					took.Add(1)
					<-release // hold: do not come back for another item
				}
			}()
		}
		time.Sleep(30 * time.Millisecond)
		for i := 0; i < pushes; i++ {
			q.Push(int64(i))
		}
		want := int32(min(consumers, pushes))
		waitFor(t, "min(N,M) consumers woken", func() bool { return took.Load() == want })
		time.Sleep(30 * time.Millisecond)
		if got := took.Load(); got != want {
			t.Fatalf("pushes=%d: %d consumers took an item, want %d", pushes, got, want)
		}
		if q.Len() != pushes-int(want) {
			t.Fatalf("pushes=%d: Len = %d, want %d", pushes, q.Len(), pushes-int(want))
		}
		close(release)
		cancel()
		wg.Wait()
	}
}

// A consumer that is handed the wake token while it is being stopped must pass
// it on, otherwise a pushed id would sit unserved next to a sleeping consumer.
// Either A takes the item (it won the race against its own stop) or B does;
// what must never happen is that neither does.
func TestJobQueueStoppedWaiterPassesWakeOn(t *testing.T) {
	for i := 0; i < 300; i++ {
		q := newJobQueue()
		stopA := make(chan struct{})
		gotA := make(chan int64, 1)
		go func() {
			if id, ok := q.Pop(context.Background(), stopA); ok {
				gotA <- id
			}
		}()
		time.Sleep(time.Millisecond) // A parks first, so Push targets A

		gotB := make(chan int64, 1)
		ctxB, cancelB := context.WithCancel(context.Background())
		go func() {
			if id, ok := q.Pop(ctxB, nil); ok {
				gotB <- id
			}
		}()
		time.Sleep(time.Millisecond)

		go close(stopA) // race A's stop against the push
		q.Push(42)
		select {
		case <-gotA:
		case <-gotB:
		case <-time.After(2 * time.Second):
			t.Fatalf("iteration %d: item stranded (Len=%d) with a consumer waiting", i, q.Len())
		}
		cancelB()
	}
}

func TestJobQueueConcurrentStress(t *testing.T) {
	q := newJobQueue()
	const producers, perProducer, consumers = 8, 500, 6
	total := producers * perProducer

	var mu sync.Mutex
	taken := map[int64]int{}
	removed := map[int64]int{}

	ctx, cancel := context.WithCancel(context.Background())
	var cwg sync.WaitGroup
	for i := 0; i < consumers; i++ {
		cwg.Add(1)
		go func() {
			defer cwg.Done()
			for {
				id, ok := q.Pop(ctx, nil)
				if !ok {
					return
				}
				mu.Lock()
				taken[id]++
				mu.Unlock()
			}
		}()
	}

	var pwg sync.WaitGroup
	for p := 0; p < producers; p++ {
		pwg.Add(1)
		go func(p int) {
			defer pwg.Done()
			for i := 0; i < perProducer; i++ {
				id := int64(p*perProducer + i)
				q.Push(id)
				// Some producers try to cancel their own id again right away.
				if i%7 == 0 && q.Remove(id) {
					mu.Lock()
					removed[id]++
					mu.Unlock()
				}
				_ = q.Len()
			}
		}(p)
	}
	pwg.Wait()

	waitFor(t, "every id taken or removed", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(taken)+len(removed) == total
	})
	cancel()
	cwg.Wait()

	mu.Lock()
	defer mu.Unlock()
	for id := int64(0); id < int64(total); id++ {
		if taken[id]+removed[id] != 1 {
			t.Fatalf("id %d: taken %d, removed %d (want exactly one)", id, taken[id], removed[id])
		}
	}
	if q.Len() != 0 {
		t.Fatalf("Len = %d", q.Len())
	}
}
