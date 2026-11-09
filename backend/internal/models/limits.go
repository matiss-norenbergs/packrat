package models

// MaxSequenceValue is the largest accepted season number, sequence number, and
// collection sequenceMin / sequenceMax. One limit for all of them (the API
// answers 400 above it, and for negatives; 0 keeps its per-field meaning —
// "clear" on edits). It exists so a mistyped bound can't make the collections
// list do work proportional to the number typed; stored values beyond it (from
// before the limit) are still handled safely by the repository.
const MaxSequenceValue = 1_000_000
