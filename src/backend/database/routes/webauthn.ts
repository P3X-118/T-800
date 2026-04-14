import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { webauthnCredentials, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// These should match the domain the user accesses the app from.
// In a self-hosted scenario, the RP ID is derived from the request origin.
function getRPConfig(req: Request) {
  const origin = req.headers.origin || `${req.protocol}://${req.get("host")}`;
  const hostname = new URL(origin).hostname;
  return {
    rpName: "T-800",
    rpID: hostname,
    origin,
  };
}

// In-memory challenge store (short-lived). For production multi-instance
// deployments you'd use Redis, but for self-hosted single-process this is fine.
const challengeStore = new Map<
  string,
  { challenge: string; timestamp: number }
>();

// Clean up expired challenges (older than 5 minutes)
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, val] of challengeStore) {
    if (val.timestamp < cutoff) challengeStore.delete(key);
  }
}, 60_000);

// ─── REGISTRATION ─────────────────────────────────────────────────────

/**
 * POST /webauthn/register/options
 * Start registration ceremony. Returns options for navigator.credentials.create().
 */
router.post(
  "/register/options",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { rpName, rpID } = getRPConfig(req);

      // Fetch the user's username for the credential display name
      const user = db.$client
        .prepare("SELECT username FROM users WHERE id = ?")
        .get(userId) as { username: string } | undefined;
      if (!user) return res.status(404).json({ error: "User not found" });

      // Fetch existing credentials so the authenticator doesn't re-register
      const existing = db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, userId))
        .all();

      const excludeCredentials = existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports
          ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
          : undefined,
      }));

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: user.username,
        attestationType: "none",
        excludeCredentials,
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      // Store challenge for verification
      challengeStore.set(`reg:${userId}`, {
        challenge: options.challenge,
        timestamp: Date.now(),
      });

      res.json(options);
    } catch (err) {
      authLogger.error("WebAuthn registration options failed", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Failed to generate options",
      });
    }
  },
);

/**
 * POST /webauthn/register/verify
 * Complete registration ceremony. Verify attestation and store credential.
 */
router.post(
  "/register/verify",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { rpID, origin } = getRPConfig(req);
      const { name } = req.body;

      const stored = challengeStore.get(`reg:${userId}`);
      if (!stored) {
        return res.status(400).json({ error: "No pending registration" });
      }
      challengeStore.delete(`reg:${userId}`);

      const verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: stored.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: "Verification failed" });
      }

      const { credential, credentialDeviceType, aaguid } =
        verification.registrationInfo;

      const id = nanoid();
      db.$client
        .prepare(
          `INSERT INTO webauthn_credentials
           (id, user_id, credential_id, public_key, counter, transports, aaguid, name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          userId,
          Buffer.from(credential.id).toString("base64url"),
          Buffer.from(credential.publicKey).toString("base64"),
          credential.counter,
          credential.transports
            ? JSON.stringify(credential.transports)
            : null,
          aaguid || null,
          name || `Security Key (${credentialDeviceType || "unknown"})`,
          new Date().toISOString(),
        );

      authLogger.success(
        `WebAuthn credential registered for user ${userId}`,
        {
          operation: "webauthn_register",
          userId,
          credentialId: id,
        },
      );

      res.json({ verified: true, credentialId: id });
    } catch (err) {
      authLogger.error("WebAuthn registration verify failed", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Registration failed",
      });
    }
  },
);

// ─── AUTHENTICATION ───────────────────────────────────────────────────

/**
 * POST /webauthn/authenticate/options
 * Start authentication ceremony. Called after password+TOTP or as
 * a standalone MFA step. Accepts a temp_token with pendingTOTP
 * or a regular JWT.
 */
router.post("/authenticate/options", async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }
    const { rpID } = getRPConfig(req);

    const creds = db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId))
      .all();

    if (creds.length === 0) {
      return res.status(404).json({ error: "No security keys registered" });
    }

    const allowCredentials = creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
        : undefined,
    }));

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: "preferred",
    });

    challengeStore.set(`auth:${userId}`, {
      challenge: options.challenge,
      timestamp: Date.now(),
    });

    res.json(options);
  } catch (err) {
    authLogger.error("WebAuthn authentication options failed", err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : "Failed to generate options",
    });
  }
});

/**
 * POST /webauthn/authenticate/verify
 * Complete authentication ceremony. Verify assertion signature.
 * On success returns { verified: true } — the caller (login endpoint
 * or frontend) then issues the full JWT.
 */
router.post("/authenticate/verify", async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }
    const { rpID, origin } = getRPConfig(req);

    const stored = challengeStore.get(`auth:${userId}`);
    if (!stored) {
      return res.status(400).json({ error: "No pending authentication" });
    }
    challengeStore.delete(`auth:${userId}`);

    // Find the credential being used
    const credentialIdFromResponse = req.body.id;
    const cred = db
      .select()
      .from(webauthnCredentials)
      .where(
        and(
          eq(webauthnCredentials.userId, userId),
          eq(webauthnCredentials.credentialId, credentialIdFromResponse),
        ),
      )
      .get();

    if (!cred) {
      return res.status(400).json({ error: "Credential not found" });
    }

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(
          Buffer.from(cred.publicKey, "base64"),
        ),
        counter: cred.counter,
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ error: "Verification failed" });
    }

    // Update counter
    db.$client
      .prepare(
        "UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?",
      )
      .run(
        verification.authenticationInfo.newCounter,
        new Date().toISOString(),
        cred.id,
      );

    authLogger.success(
      `WebAuthn authentication succeeded for user ${userId}`,
      {
        operation: "webauthn_authenticate",
        userId,
        credentialId: cred.id,
      },
    );

    res.json({ verified: true });
  } catch (err) {
    authLogger.error("WebAuthn authentication verify failed", err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : "Authentication failed",
    });
  }
});

// ─── MANAGEMENT ───────────────────────────────────────────────────────

/**
 * GET /webauthn/credentials
 * List the current user's registered security keys.
 */
router.get(
  "/credentials",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const creds = db
        .select({
          id: webauthnCredentials.id,
          name: webauthnCredentials.name,
          createdAt: webauthnCredentials.createdAt,
          lastUsedAt: webauthnCredentials.lastUsedAt,
          aaguid: webauthnCredentials.aaguid,
        })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, userId))
        .all();

      res.json({ credentials: creds });
    } catch (err) {
      res.status(500).json({ error: "Failed to list credentials" });
    }
  },
);

/**
 * DELETE /webauthn/credentials/:id
 * Remove a security key.
 */
router.delete(
  "/credentials/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const credId = req.params.id;

      const result = db.$client
        .prepare(
          "DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?",
        )
        .run(credId, userId);

      if (result.changes === 0) {
        return res.status(404).json({ error: "Credential not found" });
      }

      authLogger.info(`WebAuthn credential deleted`, {
        operation: "webauthn_delete",
        userId,
        credentialId: credId,
      });

      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete credential" });
    }
  },
);

/**
 * GET /webauthn/has-credentials/:userId
 * Public check: does a user have any WebAuthn credentials?
 * Used during login to know whether to offer the security key option.
 */
router.get("/has-credentials/:userId", async (req: Request, res: Response) => {
  try {
    const row = db.$client
      .prepare(
        "SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = ?",
      )
      .get(req.params.userId) as { count: number } | undefined;

    res.json({ hasCredentials: (row?.count ?? 0) > 0 });
  } catch {
    res.json({ hasCredentials: false });
  }
});

export default router;
