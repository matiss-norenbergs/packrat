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
