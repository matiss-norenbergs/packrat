-- Hashed tokens cannot be turned back into usable ones; a downgrade just signs everyone out again.
DELETE FROM sessions;
