package models

// Per-user preference keys (user_preferences table). The allowlist of values lives here and nowhere
// else: the API validates against it and the repository fills defaults from it.
const (
	PrefTheme  = "theme"
	PrefAccent = "accent"
)

// UserPreferenceSpec is one preference's default and the values it accepts.
type UserPreferenceSpec struct {
	Default string
	Allowed []string
}

// UserPreferenceSpecs lists every known preference. Adding a key here is all the backend needs.
var UserPreferenceSpecs = map[string]UserPreferenceSpec{
	PrefTheme:  {Default: "system", Allowed: []string{"light", "dark", "system"}},
	PrefAccent: {Default: "default", Allowed: []string{"default", "blue", "red", "green", "yellow", "mono"}},
}

// ValidUserPreference reports whether key is known and value is one of its allowed values.
func ValidUserPreference(key, value string) bool {
	spec, ok := UserPreferenceSpecs[key]
	if !ok {
		return false
	}
	for _, v := range spec.Allowed {
		if v == value {
			return true
		}
	}
	return false
}
