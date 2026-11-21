package api

import (
	"encoding/json"
	"testing"
)

type optionalProbe struct {
	N Optional[int]    `json:"n"`
	S Optional[string] `json:"s"`
}

func TestOptionalUnmarshal(t *testing.T) {
	cur := 7
	tests := []struct {
		name     string
		body     string
		wantErr  bool
		set      bool
		null     bool
		value    int
		hasValue bool
		apply    *int // expected Apply(&cur) result (nil = cleared)
	}{
		{name: "omitted", body: `{}`, apply: &cur},
		{name: "null", body: `{"n":null}`, set: true, null: true},
		{name: "value", body: `{"n":3}`, set: true, value: 3, hasValue: true, apply: ptr(3)},
		{name: "zero is a value", body: `{"n":0}`, set: true, value: 0, hasValue: true, apply: ptr(0)},
		{name: "wrong type", body: `{"n":"x"}`, wantErr: true},
		{name: "wrong type object", body: `{"n":{}}`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var p optionalProbe
			err := json.Unmarshal([]byte(tt.body), &p)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if p.N.Set() != tt.set || p.N.Null() != tt.null {
				t.Fatalf("Set/Null = %v/%v, want %v/%v", p.N.Set(), p.N.Null(), tt.set, tt.null)
			}
			v, ok := p.N.Value()
			if ok != tt.hasValue || v != tt.value {
				t.Fatalf("Value = %v,%v, want %v,%v", v, ok, tt.value, tt.hasValue)
			}
			got := p.N.Apply(&cur)
			switch {
			case tt.apply == nil && got != nil:
				t.Fatalf("Apply = %v, want nil", *got)
			case tt.apply != nil && (got == nil || *got != *tt.apply):
				t.Fatalf("Apply = %v, want %v", got, *tt.apply)
			}
		})
	}
}

func TestOptionalStringAndIndependence(t *testing.T) {
	var p optionalProbe
	if err := json.Unmarshal([]byte(`{"s":"hi"}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.N.Set() {
		t.Fatal("n should be omitted")
	}
	if v, ok := p.S.Value(); !ok || v != "hi" {
		t.Fatalf("s = %q,%v", v, ok)
	}
	// Apply must hand back a copy, not alias the Optional's storage.
	a := p.S.Apply(nil)
	*a = "changed"
	if v, _ := p.S.Value(); v != "hi" {
		t.Fatalf("Apply aliased internal value: %q", v)
	}
}
