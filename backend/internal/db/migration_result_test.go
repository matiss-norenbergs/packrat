package db

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrationResult_Upgrade(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	addGoodMig(t, migDir, 2)
	addGoodMig(t, migDir, 3)
	res, err := MigrateWithSnapshot(conn, migDir, snapDir, false)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Applied || res.From != 1 || res.To != 3 {
		t.Fatalf("result: %+v", res)
	}
	if res.Duration <= 0 {
		t.Fatalf("duration: %v", res.Duration)
	}
	if filepath.Base(res.SnapshotPath) != "packrat-pre-migration-v1-to-v3.db" || res.SnapshotSize <= 0 {
		t.Fatalf("snapshot: %q %d", res.SnapshotPath, res.SnapshotSize)
	}
	if st, err := os.Stat(res.SnapshotPath); err != nil || st.Size() != res.SnapshotSize {
		t.Fatalf("snapshot file: %v", err)
	}
}

func TestMigrationResult_NothingPending(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	res, err := MigrateWithSnapshot(conn, migDir, snapDir, false)
	if err != nil {
		t.Fatal(err)
	}
	if res.Applied || res.SnapshotPath != "" || res.From != 1 || res.To != 1 {
		t.Fatalf("an up-to-date database must report nothing applied: %+v", res)
	}
}

func TestMigrationResult_NewDatabaseAndSkip(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	addGoodMig(t, migDir, 1)
	addGoodMig(t, migDir, 2)
	res, err := MigrateWithSnapshot(conn, migDir, snapDir, false)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Applied || res.From != 0 || res.To != 2 || res.SnapshotPath != "" {
		t.Fatalf("new database: %+v", res)
	}
	addGoodMig(t, migDir, 3)
	res, err = MigrateWithSnapshot(conn, migDir, snapDir, true)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Applied || res.From != 2 || res.To != 3 || res.SnapshotPath != "" || res.SnapshotSize != 0 {
		t.Fatalf("skip: %+v", res)
	}
}

func TestSchemaVersion(t *testing.T) {
	conn, migDir, snapDir := snapFixture(t)
	if v, err := SchemaVersion(conn); err != nil || v != 0 {
		t.Fatalf("new: %d %v", v, err)
	}
	addGoodMig(t, migDir, 1)
	if _, err := MigrateWithSnapshot(conn, migDir, snapDir, false); err != nil {
		t.Fatal(err)
	}
	if v, err := SchemaVersion(conn); err != nil || v != 1 {
		t.Fatalf("after: %d %v", v, err)
	}
}
