import assert from "node:assert/strict"

// What a capability/ACL problem looks like: Tauri rejects the call with "<command> not allowed…".
export const PERMISSION_ERROR = /not allowed|\bACL\b|permission|forbidden|denied/i

/** The app's own stdout/stderr must not show a crash. */
export function assertCleanLog(log) {
  const bad = log.split("\n").filter((l) => /panicked|\bPANIC\b|fatal runtime error/i.test(l))
  assert.deepEqual(bad, [], "the app log contains panics")
}

/** No invoke the page made was refused by the capability file, and the page logged no such errors. */
export function assertNoPermissionErrors(record, bodyText = "") {
  const refused = record.invokes.filter((i) => !i.ok && PERMISSION_ERROR.test(i.error ?? ""))
  assert.deepEqual(refused, [], "Tauri refused these commands (missing capability permission?)")
  const errors = record.errors.filter((e) => PERMISSION_ERROR.test(e))
  assert.deepEqual(errors, [], "the page logged permission errors")
  assert.doesNotMatch(bodyText, /not allowed|\bACL\b/i, "the page shows a permission error")
}
