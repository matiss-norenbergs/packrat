package models

// MaxPasswordBytes is the longest password bcrypt can hash: it reads only the
// first 72 BYTES (not characters, so multi-byte text hits it sooner) and
// refuses anything longer. A new password over the limit is rejected up front
// instead of being truncated.
const MaxPasswordBytes = 72

// PasswordTooLong reports whether password exceeds MaxPasswordBytes bytes.
func PasswordTooLong(password string) bool { return len(password) > MaxPasswordBytes }

// PasswordTooLongMessage is the user-facing text for a rejected new password.
const PasswordTooLongMessage = "Password must be at most 72 bytes."
