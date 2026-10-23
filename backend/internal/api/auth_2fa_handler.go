package api

import (
	"context"
	"crypto/subtle"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"packrat/backend/internal/models"
	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/twofactor"
)

// verifySecondFactor checks a TOTP code or a recovery code for user and spends it: a TOTP step
// can't be accepted twice and a recovery code is deleted on use. Wrong or malformed input is
// (false, nil); an error means the check itself couldn't run (e.g. the secret can't be decrypted).
func (d *AuthDeps) verifySecondFactor(ctx context.Context, user *models.User, code, recoveryCode string) (bool, error) {
	if recoveryCode != "" {
		norm := twofactor.NormalizeRecoveryCode(recoveryCode)
		if norm == "" {
			return false, nil
		}
		want := d.Crypto.HashRecoveryCode(norm)
		stored, err := d.Users.ListRecoveryCodes(ctx, user.ID)
		if err != nil {
			return false, err
		}
		matched := int64(-1)
		for _, rc := range stored { // no early exit: every hash is compared in constant time
			if subtle.ConstantTimeCompare([]byte(rc.Hash), []byte(want)) == 1 {
				matched = rc.ID
			}
		}
		if matched < 0 {
			return false, nil
		}
		return d.Users.ConsumeRecoveryCode(ctx, matched)
	}

	if !twofactor.IsCodeFormat(code) {
		return false, nil
	}
	secret, err := d.Crypto.Open(user.ID, user.TOTPSecretEnc)
	if err != nil {
		return false, err
	}
	step, ok := twofactor.Verify(secret, code, d.now(), user.TOTPLastStep)
	if !ok {
		return false, nil
	}
	return d.Users.AdvanceTOTPStep(ctx, user.ID, step)
}

func internalError(c *gin.Context, err error) {
	log.Printf("auth: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// AuthLogin2FA completes a login that AuthLogin answered with a challenge: a TOTP code or a
// recovery code, and only then a session (cookies for the web, {token} for the desktop client).
// Five wrong codes destroy the challenge, so the password has to be entered again.
func AuthLogin2FA(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		if deps.rateLimited(c, ratelimit.KindCode) {
			return
		}
		var req Login2FARequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if (req.Code == "") == (req.RecoveryCode == "") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "provide either code or recoveryCode"})
			return
		}
		expired := func() {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "this login expired — enter your password again", "challengeExpired": true})
		}

		userID, ok := deps.Challenges.Lookup(req.ChallengeToken)
		if !ok {
			expired()
			return
		}
		user, err := deps.Users.GetByID(c.Request.Context(), userID)
		if err != nil {
			internalError(c, err)
			return
		}
		valid, err := deps.verifySecondFactor(c.Request.Context(), user, req.Code, req.RecoveryCode)
		if err != nil {
			internalError(c, err)
			return
		}
		if !valid {
			label := "code"
			if req.RecoveryCode != "" {
				label = "recovery-code"
			}
			deps.fail(c, ratelimit.KindCode, label)
			if deps.Challenges.Fail(req.ChallengeToken) {
				expired()
				return
			}
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid code"})
			return
		}
		// Only the request that spends the challenge may start a session.
		if !deps.Challenges.Consume(req.ChallengeToken) {
			expired()
			return
		}

		token, err := startSession(c, deps.Users, user.ID)
		if err != nil {
			internalError(c, err)
			return
		}
		deps.Limiter.Success(c.ClientIP())
		respondWithSession(c, token)
	}
}

// currentUser loads the authenticated user (RequireAuth has put the id in the context).
func (d *AuthDeps) currentUser(c *gin.Context) (*models.User, bool) {
	user, err := d.Users.GetByID(c.Request.Context(), c.MustGet("userID").(int64))
	if err != nil {
		internalError(c, err)
		return nil, false
	}
	return user, true
}

// checkPassword verifies the account password, counting a miss against the limiter.
func (d *AuthDeps) checkPassword(c *gin.Context, user *models.User, password string) bool {
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		d.fail(c, ratelimit.KindPassword, "password")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "incorrect password"})
		return false
	}
	return true
}

// newRecoveryCodes makes a set and the hashes to store for it.
func (d *AuthDeps) newRecoveryCodes() (codes, hashes []string, err error) {
	codes, err = twofactor.GenerateRecoveryCodes(twofactor.RecoveryCodeCount)
	if err != nil {
		return nil, nil, err
	}
	for _, code := range codes {
		hashes = append(hashes, d.Crypto.HashRecoveryCode(twofactor.NormalizeRecoveryCode(code)))
	}
	return codes, hashes, nil
}

func TwoFactorStatus(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := deps.currentUser(c)
		if !ok {
			return
		}
		n := 0
		if user.TOTPEnabled {
			var err error
			if n, err = deps.Users.CountRecoveryCodes(c.Request.Context(), user.ID); err != nil {
				internalError(c, err)
				return
			}
		}
		c.JSON(http.StatusOK, TwoFactorStatusResponse{Enabled: user.TOTPEnabled, RecoveryCodesRemaining: n})
	}
}

// TwoFactorSetup starts enrolment: a fresh pending secret (replacing any earlier one) that only
// becomes active once a code from it is confirmed at /auth/2fa/enable.
func TwoFactorSetup(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := deps.currentUser(c)
		if !ok {
			return
		}
		if user.TOTPEnabled {
			c.JSON(http.StatusConflict, gin.H{"error": "two-factor authentication is already enabled"})
			return
		}
		secret, url, err := twofactor.GenerateSecret(user.Username)
		if err != nil {
			internalError(c, err)
			return
		}
		sealed, err := deps.Crypto.Seal(user.ID, secret)
		if err != nil {
			internalError(c, err)
			return
		}
		if err := deps.Users.SetPendingTOTP(c.Request.Context(), user.ID, sealed); err != nil {
			internalError(c, err)
			return
		}
		c.JSON(http.StatusOK, TwoFactorSetupResponse{Secret: secret, OtpauthURL: url})
	}
}

// TwoFactorEnable confirms the pending secret with a code, switches 2FA on and returns the
// recovery codes — the only time they are shown.
func TwoFactorEnable(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		if deps.rateLimited(c, ratelimit.KindCode) {
			return
		}
		var req TwoFactorEnableRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		user, ok := deps.currentUser(c)
		if !ok {
			return
		}
		if user.TOTPEnabled {
			c.JSON(http.StatusConflict, gin.H{"error": "two-factor authentication is already enabled"})
			return
		}
		if user.TOTPPendingEnc == "" {
			c.JSON(http.StatusConflict, gin.H{"error": "start setup first"})
			return
		}
		secret, err := deps.Crypto.Open(user.ID, user.TOTPPendingEnc)
		if err != nil {
			internalError(c, err)
			return
		}
		step, valid := twofactor.Verify(secret, req.Code, deps.now(), 0)
		if !valid {
			deps.fail(c, ratelimit.KindCode, "code")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid code"})
			return
		}
		codes, hashes, err := deps.newRecoveryCodes()
		if err != nil {
			internalError(c, err)
			return
		}
		if err := deps.Users.EnableTOTP(c.Request.Context(), user.ID, user.TOTPPendingEnc, step, hashes); err != nil {
			internalError(c, err)
			return
		}
		c.JSON(http.StatusOK, RecoveryCodesResponse{RecoveryCodes: codes})
	}
}

// TwoFactorDisable turns 2FA off. A stolen session alone can't do it: it takes the password and a
// current code (or an unused recovery code).
func TwoFactorDisable(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		if deps.rateLimited(c, ratelimit.KindPassword, ratelimit.KindCode) {
			return
		}
		var req TwoFactorDisableRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if (req.Code == "") == (req.RecoveryCode == "") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "provide either code or recoveryCode"})
			return
		}
		user, ok := deps.currentUser(c)
		if !ok {
			return
		}
		if !user.TOTPEnabled {
			c.JSON(http.StatusConflict, gin.H{"error": "two-factor authentication is not enabled"})
			return
		}
		if !deps.checkPassword(c, user, req.Password) {
			return
		}
		valid, err := deps.verifySecondFactor(c.Request.Context(), user, req.Code, req.RecoveryCode)
		if err != nil {
			internalError(c, err)
			return
		}
		if !valid {
			deps.fail(c, ratelimit.KindCode, "code")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid code"})
			return
		}
		if err := deps.Users.DisableTOTP(c.Request.Context(), user.ID); err != nil {
			internalError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// TwoFactorRegenerateCodes replaces the recovery codes with a new set; the old ones stop working.
func TwoFactorRegenerateCodes(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		if deps.rateLimited(c, ratelimit.KindPassword, ratelimit.KindCode) {
			return
		}
		var req TwoFactorRegenerateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		user, ok := deps.currentUser(c)
		if !ok {
			return
		}
		if !user.TOTPEnabled {
			c.JSON(http.StatusConflict, gin.H{"error": "two-factor authentication is not enabled"})
			return
		}
		if !deps.checkPassword(c, user, req.Password) {
			return
		}
		valid, err := deps.verifySecondFactor(c.Request.Context(), user, req.Code, "")
		if err != nil {
			internalError(c, err)
			return
		}
		if !valid {
			deps.fail(c, ratelimit.KindCode, "code")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid code"})
			return
		}
		codes, hashes, err := deps.newRecoveryCodes()
		if err != nil {
			internalError(c, err)
			return
		}
		if err := deps.Users.ReplaceRecoveryCodes(c.Request.Context(), user.ID, hashes); err != nil {
			internalError(c, err)
			return
		}
		c.JSON(http.StatusOK, RecoveryCodesResponse{RecoveryCodes: codes})
	}
}

// SecurityNotice reports failed attempts since the owner last dismissed the notice.
func SecurityNotice(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := deps.currentUser(c)
		if !ok {
			return
		}
		sum, err := deps.Users.LoginFailuresSince(c.Request.Context(), user)
		if err != nil {
			internalError(c, err)
			return
		}
		resp := SecurityNoticeResponse{FailedAttempts: sum.Count, Since: sum.Since.UTC().Format(time.RFC3339)}
		if sum.Last != nil {
			s := sum.Last.UTC().Format(time.RFC3339)
			resp.LastAttemptAt = &s
		}
		c.JSON(http.StatusOK, resp)
	}
}

func SecurityNoticeAck(deps *AuthDeps) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("userID").(int64)
		if err := deps.Users.AckSecurityNotice(c.Request.Context(), userID, deps.now()); err != nil {
			internalError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}
