DROP TABLE login_failures;
DROP TABLE recovery_codes;
ALTER TABLE users DROP COLUMN security_ack_at;
ALTER TABLE users DROP COLUMN totp_last_step;
ALTER TABLE users DROP COLUMN totp_enabled;
ALTER TABLE users DROP COLUMN totp_pending_enc;
ALTER TABLE users DROP COLUMN totp_secret_enc;
