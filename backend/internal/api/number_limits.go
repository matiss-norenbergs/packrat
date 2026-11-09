package api

import (
	"fmt"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/models"
)

// checkNumberLimit validates one optional season / sequence number (or a
// collection's sequenceMin / sequenceMax): nil is fine, otherwise it must be
// 0..models.MaxSequenceValue. 0 keeps its per-field meaning (on edits it
// clears the field); negatives and anything above the limit are refused, so a
// mistyped value can't later make the collections list do work proportional to
// the number typed.
func checkNumberLimit(field string, v *int) error {
	if v == nil {
		return nil
	}
	if *v < 0 || *v > models.MaxSequenceValue {
		return fmt.Errorf("%s must be between 0 and %d", field, models.MaxSequenceValue)
	}
	return nil
}

// firstNumberLimitError returns the first failing check.
func firstNumberLimitError(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

func (r CreateDownloadRequest) checkNumberLimits() error {
	return firstNumberLimitError(
		checkNumberLimit("seasonNumber", r.SeasonNumber),
		checkNumberLimit("sequenceNumber", r.SequenceNumber),
	)
}

func (r CreateGhostLibraryItemRequest) checkNumberLimits() error {
	return firstNumberLimitError(
		checkNumberLimit("seasonNumber", r.SeasonNumber),
		checkNumberLimit("sequenceNumber", r.SequenceNumber),
	)
}

func (r UpdateLibraryItemRequest) checkNumberLimits() error {
	return firstNumberLimitError(
		checkNumberLimit("seasonNumber", r.SeasonNumber),
		checkNumberLimit("sequenceNumber", r.SequenceNumber),
	)
}

func (r CreateCollectionRequest) checkNumberLimits() error {
	return firstNumberLimitError(
		checkNumberLimit("seasonNumber", r.SeasonNumber),
		checkNumberLimit("sequenceMin", r.SequenceMin),
		checkNumberLimit("sequenceMax", r.SequenceMax),
	)
}

func (r UpdateCollectionRequest) checkNumberLimits() error {
	return firstNumberLimitError(
		checkNumberLimit("seasonNumber", r.SeasonNumber),
		checkNumberLimit("sequenceMin", r.SequenceMin),
		checkNumberLimit("sequenceMax", r.SequenceMax),
	)
}

// checkBundleNumberLimits validates the season / sequence numbers in a library
// bundle being imported, naming the offending entry. (A full restore does not
// call this: it must be able to bring back whatever was exported, and the
// repository is safe for any stored value.)
func checkBundleNumberLimits(b backup.LibraryBundle) error {
	for _, c := range b.Collections {
		if err := checkNumberLimit("seasonNumber", c.SeasonNumber); err != nil {
			return fmt.Errorf("collection %q: %w", c.Name, err)
		}
	}
	for i, it := range b.LibraryItems {
		err := firstNumberLimitError(checkNumberLimit("seasonNumber", it.SeasonNumber), checkNumberLimit("sequenceNumber", it.SequenceNumber))
		if err != nil {
			name := it.Title
			if name == "" {
				name = fmt.Sprintf("#%d", i+1)
			}
			return fmt.Errorf("item %q: %w", name, err)
		}
	}
	return nil
}
