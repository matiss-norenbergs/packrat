package ratelimit

import (
	"fmt"
	"testing"
)

func TestOnLockoutFiresOncePerPerIPBlock(t *testing.T) {
	l := New(nil)
	var got []Lockout
	l.SetOnLockout(func(lo Lockout) { got = append(got, lo) })

	for i := 0; i < PerIPMaxFailures-1; i++ {
		l.Fail("1.1.1.1", KindPassword)
	}
	if len(got) != 0 {
		t.Fatalf("fired before the block started: %v", got)
	}
	l.Fail("1.1.1.1", KindPassword)
	if len(got) != 1 || got[0].IP != "1.1.1.1" || got[0].Global || got[0].Duration != PerIPWindow || got[0].Kind != KindPassword {
		t.Fatalf("got %+v", got)
	}
	// Reservations that fail go through the same path.
	res, wait := l.Reserve("2.2.2.2", KindPassword)
	if wait != 0 {
		t.Fatal(wait)
	}
	res.Fail(KindPassword)
	if len(got) != 1 {
		t.Fatalf("a single failure from another address fired: %v", got)
	}
}

func TestOnLockoutFiresOnceWhenTheGlobalBudgetTrips(t *testing.T) {
	l := New(nil)
	var global int
	l.SetOnLockout(func(lo Lockout) {
		if lo.Global {
			global++
		}
	})
	for i := 0; i < GlobalMaxCode; i++ {
		l.Fail(fmt.Sprintf("10.0.0.%d", i), KindCode) // distinct addresses: only the global budget trips
	}
	if global != 1 {
		t.Fatalf("global lockouts = %d, want 1", global)
	}
}

func TestOnLockoutIsOptional(t *testing.T) {
	l := New(nil)
	for i := 0; i < PerIPMaxFailures+2; i++ {
		l.Fail("3.3.3.3", KindPassword) // no callback registered
	}
}
