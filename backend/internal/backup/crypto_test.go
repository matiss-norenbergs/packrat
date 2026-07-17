package backup

import "testing"

func TestEncryptDecryptRoundTrip(t *testing.T) {
	plaintext := []byte(`{"hello":"world"}`)
	salt, ciphertext, err := encrypt(plaintext, "correct horse battery staple")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	got, err := decrypt(salt, ciphertext, "correct horse battery staple")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if string(got) != string(plaintext) {
		t.Fatalf("expected %q, got %q", plaintext, got)
	}
}

func TestDecryptWrongPassword(t *testing.T) {
	salt, ciphertext, err := encrypt([]byte("secret data"), "right password")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	if _, err := decrypt(salt, ciphertext, "wrong password"); err != ErrIncorrectPassword {
		t.Fatalf("expected ErrIncorrectPassword, got %v", err)
	}
}

func TestSealOpenRoundTrip_Unencrypted(t *testing.T) {
	plaintext := []byte(`{"a":1}`)
	env, err := Seal("settings", plaintext, "")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if env.Encrypted {
		t.Fatalf("expected Encrypted=false for empty password")
	}

	got, err := Open(env, "settings", "")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if string(got) != string(plaintext) {
		t.Fatalf("expected %q, got %q", plaintext, got)
	}
}

func TestSealOpenRoundTrip_Encrypted(t *testing.T) {
	plaintext := []byte(`{"a":1}`)
	env, err := Seal("library", plaintext, "hunter2")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if !env.Encrypted || env.Salt == "" {
		t.Fatalf("expected Encrypted=true with a salt, got %+v", env)
	}

	got, err := Open(env, "library", "hunter2")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if string(got) != string(plaintext) {
		t.Fatalf("expected %q, got %q", plaintext, got)
	}

	if _, err := Open(env, "library", "wrong"); err != ErrIncorrectPassword {
		t.Fatalf("expected ErrIncorrectPassword, got %v", err)
	}
}

func TestOpenWrongKind(t *testing.T) {
	env, err := Seal("settings", []byte(`{}`), "")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if _, err := Open(env, "library", ""); err == nil {
		t.Fatalf("expected an error importing a settings file as library")
	}
}

func TestOpenNotPackratExport(t *testing.T) {
	env, err := ParseEnvelope(`{"hello":"world"}`)
	if err != nil {
		t.Fatalf("ParseEnvelope: %v", err)
	}
	if _, err := Open(env, "settings", ""); err != ErrNotPackratExport {
		t.Fatalf("expected ErrNotPackratExport, got %v", err)
	}
}
