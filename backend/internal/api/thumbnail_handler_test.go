package api

import "testing"

func TestValidateFramePick(t *testing.T) {
	cases := []struct {
		name    string
		count   int
		low, hi float64
		wantErr bool
	}{
		{"fractional range", 4, 12.5, 87.25, false},
		{"fractional low equals high", 4, 50.5, 50.5, true},
		{"defaults", 4, 5, 100, false},
		{"min count", 1, 0, 1, false},
		{"max count", 50, 0, 100, false},
		{"count zero", 0, 5, 100, true},
		{"count too high", 51, 5, 100, true},
		{"negative low", 4, -1, 100, true},
		{"high over 100", 4, 5, 101, true},
		{"low equals high", 4, 50, 50, true},
		{"low above high", 4, 60, 40, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateFramePick(tc.count, tc.low, tc.hi)
			if (err != nil) != tc.wantErr {
				t.Fatalf("validateFramePick(%d, %v, %v) err = %v, wantErr %v", tc.count, tc.low, tc.hi, err, tc.wantErr)
			}
		})
	}
}
