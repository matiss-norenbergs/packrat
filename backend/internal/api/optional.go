package api

import (
	"bytes"
	"encoding/json"
)

// Optional distinguishes the three states a JSON field can be in on a PATCH
// body: the key is omitted (leave the stored value alone), the key is an
// explicit null (clear it), or the key carries a value (set it). A plain
// pointer can't tell the first two apart.
//
// encoding/json calls UnmarshalJSON only when the key is present, so the zero
// Optional means "omitted".
type Optional[T any] struct {
	set   bool
	null  bool
	value T
}

// UnmarshalJSON records that the key was present and whether it was null.
// A value of the wrong type is an error (the bind fails with 400).
func (o *Optional[T]) UnmarshalJSON(b []byte) error {
	var zero T
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.set, o.null, o.value = true, true, zero
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.set, o.null, o.value = true, false, v
	return nil
}

// Set reports whether the key was present in the body (null included).
func (o Optional[T]) Set() bool { return o.set }

// Null reports whether the key was present with an explicit null.
func (o Optional[T]) Null() bool { return o.set && o.null }

// Value returns the supplied value; ok is false when omitted or null.
func (o Optional[T]) Value() (v T, ok bool) {
	if !o.set || o.null {
		return v, false
	}
	return o.value, true
}

// Ptr returns a pointer to a copy of the supplied value, or nil when the key
// was omitted or null. Use it for validation of what the request itself sent.
func (o Optional[T]) Ptr() *T {
	if v, ok := o.Value(); ok {
		return &v
	}
	return nil
}

// Apply overlays the field onto the stored value: omitted keeps current,
// null clears (nil), a value returns a pointer to a copy of it.
func (o Optional[T]) Apply(current *T) *T {
	if !o.set {
		return current
	}
	return o.Ptr()
}
