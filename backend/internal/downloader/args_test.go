package downloader

import (
	"reflect"
	"testing"
)

func TestBuildGlobalArgs(t *testing.T) {
	tests := []struct {
		name                                                 string
		cookiesBrowser, cookiesProfile, proxy, rate, retries string
		want                                                 []string
	}{
		{
			name: "all unset produces no flags",
			want: nil,
		},
		{
			name:           "cookies browser only",
			cookiesBrowser: "firefox",
			want:           []string{"--cookies-from-browser", "firefox"},
		},
		{
			name:           "cookies browser with profile",
			cookiesBrowser: "firefox",
			cookiesProfile: "Default",
			want:           []string{"--cookies-from-browser", "firefox:Default"},
		},
		{
			name:  "proxy only",
			proxy: "socks5://127.0.0.1:1080",
			want:  []string{"--proxy", "socks5://127.0.0.1:1080"},
		},
		{
			name: "rate limit only",
			rate: "500K",
			want: []string{"--limit-rate", "500K"},
		},
		{
			name:    "retries zero means unset",
			retries: "0",
			want:    nil,
		},
		{
			name:    "retries positive sets both retry flags",
			retries: "3",
			want:    []string{"--retries", "3", "--fragment-retries", "3"},
		},
		{
			name:    "retries non-numeric ignored",
			retries: "not-a-number",
			want:    nil,
		},
		{
			name:           "everything set combines in order",
			cookiesBrowser: "chrome",
			cookiesProfile: "Profile 1",
			proxy:          "http://proxy:8080",
			rate:           "1M",
			retries:        "5",
			want: []string{
				"--cookies-from-browser", "chrome:Profile 1",
				"--proxy", "http://proxy:8080",
				"--limit-rate", "1M",
				"--retries", "5", "--fragment-retries", "5",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildGlobalArgs(tt.cookiesBrowser, tt.cookiesProfile, tt.proxy, tt.rate, tt.retries)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("buildGlobalArgs(%q, %q, %q, %q, %q) = %#v, want %#v",
					tt.cookiesBrowser, tt.cookiesProfile, tt.proxy, tt.rate, tt.retries, got, tt.want)
			}
		})
	}
}
