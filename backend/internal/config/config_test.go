package config

import (
	"reflect"
	"testing"
)

func TestParseOrigins(t *testing.T) {
	got, err := parseOrigins(" http://a.example/ , ,tauri://localhost")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"http://a.example", "tauri://localhost"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if _, err := parseOrigins("http://a.example,*"); err == nil {
		t.Fatal("wildcard must be rejected")
	}
}

func TestParseTrustedProxies(t *testing.T) {
	got, err := parseTrustedProxies(" 10.0.0.0/8 , ,192.168.1.5,fd00::/8")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"10.0.0.0/8", "192.168.1.5", "fd00::/8"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for _, bad := range []string{"proxy.example.com", "10.0.0.0/33", "*"} {
		if _, err := parseTrustedProxies(bad); err == nil {
			t.Fatalf("%q must be rejected", bad)
		}
	}
}
