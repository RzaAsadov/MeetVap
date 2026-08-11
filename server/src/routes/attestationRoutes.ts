import crypto from 'crypto';
import fs from 'fs/promises';
import { Request, Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { verifyAppleAssertion, verifyAppleAttestation } from '../appleAppAttest';
import { invalidateAttestationAccess } from '../attestationAccess';
import { getAuthedUser } from '../auth';
import { getRequestClientMetadata, hashAccessToken } from '../clientCompatibility';
import { config } from '../config';
import { HttpError } from '../httpError';
import { assertDeviceIdentifierAllowed } from '../deviceAccess';
import { getAttestationMode, operationalConfig } from '../operationalConfig';
import { prisma } from '../prisma';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const VALID_PLATFORM_VALUES = ['android', 'ios'] as const;
const VALID_PROVIDER_VALUES = ['play-integrity', 'app-attest'] as const;

const challengeInputSchema = z.object({
  keyId: z.string().min(40).max(128).optional(),
  platform: z.enum(VALID_PLATFORM_VALUES),
  purpose: z.enum(['assertion', 'registration']).optional(),
  provider: z.enum(VALID_PROVIDER_VALUES).optional(),
});

const androidPlayIntegrityInputSchema = z.object({
  challengeId: z.string().min(1),
  token: z.string().min(20),
});

const iosAppAttestInputSchema = z.object({
  attestationObject: z.string().min(20).max(200_000),
  challengeId: z.string().min(1),
  keyId: z.string().min(40).max(128),
});

const iosAppAttestAssertionInputSchema = z.object({
  assertionObject: z.string().min(20).max(100_000),
  challengeId: z.string().min(1),
  keyId: z.string().min(40).max(128),
});

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
};

type PlayIntegrityResponse = {
  accountDetails?: {
    appLicensingVerdict?: string;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    certificateSha256Digest?: string[];
    packageName?: string;
    versionCode?: string;
  };
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[];
  };
  requestDetails?: {
    nonce?: string;
    requestHash?: string;
    requestPackageName?: string;
    timestampMillis?: string;
  };
};

export const attestationRoutes = Router();

attestationRoutes.post('/challenge', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = challengeInputSchema.parse(req.body);
    const provider = input.provider ?? (input.platform === 'android' ? 'play-integrity' : 'app-attest');
    const purpose = input.platform === 'ios' ? input.purpose ?? 'registration' : null;

    if (input.platform === 'ios' && purpose === 'assertion') {
      if (!input.keyId) {
        throw new HttpError(400, 'App Attest assertion requires a key identifier');
      }

      const registeredKey = await prisma.appAttestKey.findFirst({
        select: { id: true },
        where: {
          keyId: input.keyId,
          revokedAt: null,
          userId: currentUser.id,
        },
      });

      if (!registeredKey) {
        throw new HttpError(409, 'App Attest key is not registered', {
          code: 'APP_ATTEST_KEY_NOT_REGISTERED',
        });
      }
    }

    const challenge = base64UrlEncode(crypto.randomBytes(32));
    const session = await getCurrentSession(req, currentUser.id);
    const expiresAt = new Date(Date.now() + operationalConfig.attestation.challengeTtlMinutes * 60_000);

    const row = await prisma.attestationChallenge.create({
      data: {
        challengeHash: hashChallenge(challenge),
        clientDataHash: hashBase64UrlChallengeBytes(challenge),
        challengeValue: challenge,
        deviceKeyId: input.keyId ?? null,
        expiresAt,
        platform: input.platform,
        purpose,
        provider,
        sessionId: session?.id ?? null,
        userId: currentUser.id,
      },
    });

    res.json({
      challenge,
      challengeId: row.id,
      expiresAt: expiresAt.toISOString(),
      mode: getAttestationMode(input.platform),
      purpose,
      provider,
      retryAfterSeconds: operationalConfig.attestation.unevaluatedRetryAfterSeconds,
    });
  } catch (error) {
    next(error);
  }
});

attestationRoutes.post('/android/play-integrity', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = androidPlayIntegrityInputSchema.parse(req.body);
    const challenge = await consumeChallenge(req, currentUser.id, input.challengeId, 'android', 'play-integrity');
    const metadata = getRequestClientMetadata(req);

    if (!config.GOOGLE_PACKAGE_NAME || !hasGoogleServiceAccountConfig()) {
      const attestation = await recordAttestation(req, {
        challengeId: input.challengeId,
        failureReason: 'google_play_integrity_not_configured',
        platform: 'android',
        provider: 'play-integrity',
        status: getAttestationMode('android') === 'enforce' ? 'FAILED' : 'PENDING',
        userId: currentUser.id,
        verdict: {
          mode: getAttestationMode('android'),
          reason: 'Google Play Integrity service account or package name is not configured',
        },
      });

      res.json({ ok: true, status: attestation.status });
      return;
    }

    const verdict = await decodePlayIntegrityToken(input.token);
    const evaluation = evaluatePlayIntegrityVerdict(
      verdict,
      challenge.challengeHash,
      challenge.clientDataHash,
    );
    const verifiedBuildNumber = evaluation.status === 'TRUSTED'
      ? getPlayIntegrityBuildNumber(verdict)
      : undefined;
    const attestation = await recordAttestation(req, {
      appBuildNumber: verifiedBuildNumber,
      challengeId: input.challengeId,
      failureReason: evaluation.status === 'TRUSTED' ? null : evaluation.reason,
      platform: 'android',
      provider: 'play-integrity',
      status: evaluation.status,
      userId: currentUser.id,
      verdict: {
        ...verdict,
        client: metadata,
        evaluation,
      },
    });

    if (evaluation.reason === 'app_integrity_unevaluated') {
      const retryAfterSeconds = operationalConfig.attestation.unevaluatedRetryAfterSeconds;
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(503).json({
        code: 'ATTESTATION_RETRY_REQUIRED',
        error: 'Google Play could not evaluate app integrity yet',
        ok: false,
        retryAfterSeconds,
        retryable: true,
        status: attestation.status,
      });
      return;
    }

    res.json({
      ok: true,
      status: attestation.status,
    });
  } catch (error) {
    next(error);
  }
});

attestationRoutes.post('/ios/app-attest/register', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = iosAppAttestInputSchema.parse(req.body);
    const appleConfig = getAppleAppAttestConfig();
    await assertDeviceIdentifierAllowed('APP_ATTEST_KEY', input.keyId);
    const challenge = await consumeChallenge(
      req,
      currentUser.id,
      input.challengeId,
      'ios',
      'app-attest',
      'registration',
      input.keyId,
    );
    const session = await getCurrentSession(req, currentUser.id);
    const metadata = getRequestClientMetadata(req);
    const existingKey = await prisma.appAttestKey.findUnique({
      where: { keyId: input.keyId },
    });

    if (existingKey && (existingKey.userId !== currentUser.id || existingKey.revokedAt)) {
      throw new HttpError(409, 'App Attest key cannot be registered', {
        code: 'APP_ATTEST_KEY_CONFLICT',
      });
    }

    let verified: Awaited<ReturnType<typeof verifyAppleAttestation>>;

    try {
      verified = await verifyAppleAttestation({
        ...appleConfig,
        attestationObject: input.attestationObject,
        challenge: requireChallengeValue(challenge.challengeValue),
        keyId: input.keyId,
      });
    } catch (error) {
      const failureReason = getAppleVerificationFailureReason(error);
      await recordAttestation(req, {
        challengeId: input.challengeId,
        deviceKeyId: input.keyId,
        failureReason,
        platform: 'ios',
        provider: 'app-attest',
        status: 'UNTRUSTED',
        userId: currentUser.id,
        verdict: { evaluation: failureReason },
      });
      throw new HttpError(422, 'Apple App Attest verification failed', {
        code: 'APP_ATTEST_VERIFICATION_FAILED',
      });
    }

    await prisma.appAttestKey.upsert({
      create: {
        appBuildNumber: verified.appBuildNumber,
        appVersion: metadata.appVersion ?? null,
        environment: verified.environment,
        installationId: metadata.installationId ?? session?.installationId ?? null,
        keyId: input.keyId,
        publicKeyPem: verified.publicKeyPem,
        receiptBase64: verified.receiptBase64,
        sessionId: session?.id ?? null,
        signCount: 0,
        userId: currentUser.id,
      },
      update: {
        appBuildNumber: verified.appBuildNumber,
        appVersion: metadata.appVersion ?? existingKey?.appVersion ?? null,
        environment: verified.environment,
        installationId: metadata.installationId ?? session?.installationId ?? existingKey?.installationId ?? null,
        publicKeyPem: verified.publicKeyPem,
        receiptBase64: verified.receiptBase64,
        sessionId: session?.id ?? null,
        signCount: 0,
      },
      where: { keyId: input.keyId },
    });

    const attestation = await recordAttestation(req, {
      appBuildNumber: verified.appBuildNumber,
      challengeId: input.challengeId,
      deviceKeyId: input.keyId,
      platform: 'ios',
      provider: 'app-attest',
      status: 'TRUSTED',
      userId: currentUser.id,
      verdict: {
        bundleIdentifier: appleConfig.bundleIdentifier,
        environment: verified.environment,
        validationCategory: verified.validationCategory,
      },
    });

    res.json({ ok: true, status: attestation.status });
  } catch (error) {
    next(error);
  }
});

attestationRoutes.post('/ios/app-attest/assert', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const input = iosAppAttestAssertionInputSchema.parse(req.body);
    const appleConfig = getAppleAppAttestConfig();
    await assertDeviceIdentifierAllowed('APP_ATTEST_KEY', input.keyId);
    const registeredKey = await prisma.appAttestKey.findFirst({
      where: {
        keyId: input.keyId,
        revokedAt: null,
        userId: currentUser.id,
      },
    });

    if (!registeredKey) {
      throw new HttpError(409, 'App Attest key is not registered', {
        code: 'APP_ATTEST_KEY_NOT_REGISTERED',
      });
    }

    const challenge = await consumeChallenge(
      req,
      currentUser.id,
      input.challengeId,
      'ios',
      'app-attest',
      'assertion',
      input.keyId,
    );
    let verified: Awaited<ReturnType<typeof verifyAppleAssertion>>;

    try {
      verified = await verifyAppleAssertion({
        ...appleConfig,
        assertionObject: input.assertionObject,
        challenge: requireChallengeValue(challenge.challengeValue),
        publicKeyPem: registeredKey.publicKeyPem,
        signCount: registeredKey.signCount,
      });
    } catch (error) {
      const failureReason = getAppleVerificationFailureReason(error);
      await recordAttestation(req, {
        appBuildNumber: registeredKey.appBuildNumber ?? undefined,
        challengeId: input.challengeId,
        deviceKeyId: input.keyId,
        failureReason,
        platform: 'ios',
        provider: 'app-attest',
        status: 'UNTRUSTED',
        userId: currentUser.id,
        verdict: { evaluation: failureReason },
      });
      throw new HttpError(422, 'Apple App Attest assertion failed', {
        code: 'APP_ATTEST_ASSERTION_FAILED',
      });
    }

    const session = await getCurrentSession(req, currentUser.id);
    const metadata = getRequestClientMetadata(req);
    const counterUpdate = await prisma.appAttestKey.updateMany({
      data: {
        installationId: metadata.installationId ?? session?.installationId ?? registeredKey.installationId,
        lastAssertedAt: new Date(),
        sessionId: session?.id ?? null,
        signCount: verified.signCount,
      },
      where: {
        id: registeredKey.id,
        revokedAt: null,
        signCount: registeredKey.signCount,
      },
    });

    if (counterUpdate.count !== 1) {
      throw new HttpError(409, 'App Attest assertion counter was already used', {
        code: 'APP_ATTEST_ASSERTION_REPLAYED',
      });
    }

    const attestation = await recordAttestation(req, {
      appBuildNumber: registeredKey.appBuildNumber ?? undefined,
      challengeId: input.challengeId,
      deviceKeyId: input.keyId,
      platform: 'ios',
      provider: 'app-attest',
      status: 'TRUSTED',
      userId: currentUser.id,
      verdict: {
        environment: registeredKey.environment,
        signCount: verified.signCount,
      },
    });

    res.json({ ok: true, status: attestation.status });
  } catch (error) {
    next(error);
  }
});

attestationRoutes.get('/status', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const session = await getCurrentSession(req, currentUser.id);
    const latest = await prisma.deviceAttestation.findFirst({
      orderBy: { lastAttestedAt: 'desc' },
      where: {
        userId: currentUser.id,
        ...(session ? { sessionId: session.id } : {}),
      },
    });

    res.json({
      attestation: latest
        ? {
            expiresAt: latest.expiresAt?.toISOString() ?? null,
            lastAttestedAt: latest.lastAttestedAt.toISOString(),
            platform: latest.platform,
            provider: latest.provider,
            status: latest.status,
          }
        : null,
      mode: latest?.platform === 'android' || latest?.platform === 'ios'
        ? getAttestationMode(latest.platform)
        : operationalConfig.attestation.mode,
    });
  } catch (error) {
    next(error);
  }
});

async function consumeChallenge(
  req: Request,
  userId: string,
  challengeId: string,
  platform: typeof VALID_PLATFORM_VALUES[number],
  provider: typeof VALID_PROVIDER_VALUES[number],
  purpose?: 'assertion' | 'registration',
  deviceKeyId?: string,
) {
  const challenge = await prisma.attestationChallenge.findFirst({
    where: {
      consumedAt: null,
      expiresAt: { gt: new Date() },
      id: challengeId,
      platform,
      provider,
      userId,
    },
  });

  if (!challenge) {
    throw new HttpError(400, 'Invalid or expired attestation challenge');
  }

  const session = await getCurrentSession(req, userId);

  if (challenge.sessionId && session?.id && challenge.sessionId !== session.id) {
    throw new HttpError(400, 'Attestation challenge belongs to a different session');
  }

  if (purpose && challenge.purpose !== purpose) {
    throw new HttpError(400, 'Attestation challenge has an invalid purpose');
  }

  if (purpose === 'assertion' && !challenge.deviceKeyId) {
    throw new HttpError(400, 'App Attest assertion challenge is not bound to a key');
  }

  if (deviceKeyId && challenge.deviceKeyId && challenge.deviceKeyId !== deviceKeyId) {
    throw new HttpError(400, 'Attestation challenge belongs to a different key');
  }

  await prisma.attestationChallenge.update({
    data: { consumedAt: new Date() },
    where: { id: challenge.id },
  });

  return challenge;
}

function getAppleAppAttestConfig() {
  if (!config.APPLE_APP_ATTEST_APP_ID_PREFIX || !config.APPLE_BUNDLE_ID) {
    throw new HttpError(503, 'Apple App Attest verification is not configured', {
      code: 'ATTESTATION_RETRY_REQUIRED',
      retryAfterSeconds: operationalConfig.attestation.unevaluatedRetryAfterSeconds,
    });
  }

  return {
    allowDevelopmentEnvironment: config.APPLE_APP_ATTEST_ALLOW_DEVELOPMENT,
    appIdPrefix: config.APPLE_APP_ATTEST_APP_ID_PREFIX,
    bundleIdentifier: config.APPLE_BUNDLE_ID,
  };
}

function requireChallengeValue(value?: string | null) {
  if (!value) {
    throw new HttpError(400, 'Attestation challenge cannot be verified');
  }

  return value;
}

function getAppleVerificationFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : 'verification_failed';
  const normalized = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

  return `ios_app_attest_${normalized || 'verification_failed'}`;
}

async function recordAttestation(req: Request, input: {
  appBuildNumber?: number;
  challengeId: string;
  deviceKeyId?: string | null;
  failureReason?: string | null;
  platform: string;
  provider: string;
  status: string;
  userId: string;
  verdict: Prisma.InputJsonValue;
}) {
  const session = await getCurrentSession(req, input.userId);
  const metadata = getRequestClientMetadata(req);
  const expiresAt = new Date(Date.now() + operationalConfig.attestation.trustTtlHours * 60 * 60_000);

  const attestation = await prisma.deviceAttestation.create({
    data: {
      appBuildNumber: input.appBuildNumber ?? metadata.appBuildNumber ?? session?.appBuildNumber ?? null,
      appVersion: metadata.appVersion ?? session?.appVersion ?? null,
      challengeId: input.challengeId,
      deviceKeyId: input.deviceKeyId ?? null,
      expiresAt,
      failureReason: input.failureReason ?? null,
      platform: input.platform,
      provider: input.provider,
      sessionId: session?.id ?? null,
      status: input.status,
      userId: input.userId,
      verdict: input.verdict,
    },
  });

  if (session && input.appBuildNumber) {
    await prisma.$transaction([
      prisma.session.update({
        data: { appBuildNumber: input.appBuildNumber },
        where: { id: session.id },
      }),
      ...(session.installationId
        ? [prisma.devicePushToken.updateMany({
            data: { appBuildNumber: input.appBuildNumber },
            where: {
              installationId: session.installationId,
              userId: input.userId,
            },
          })]
        : []),
    ]);
  }

  await invalidateAttestationAccess(session?.tokenHash);

  return attestation;
}

async function getCurrentSession(req: Request, userId: string) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  return prisma.session.findFirst({
    where: {
      tokenHash: hashAccessToken(token),
      userId,
    },
  });
}

function getBearerToken(req: Request) {
  const authHeader = req.header('Authorization');

  return authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
}

async function decodePlayIntegrityToken(integrityToken: string) {
  const accessToken = await getGoogleAccessToken(PLAY_INTEGRITY_SCOPE);
  const response = await fetch(
    `https://playintegrity.googleapis.com/v1/${encodeURIComponent(config.GOOGLE_PACKAGE_NAME ?? '')}:decodeIntegrityToken`,
    {
      body: JSON.stringify({ integrity_token: integrityToken }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );

  if (!response.ok) {
    throw new HttpError(400, `Google Play Integrity verification failed with ${response.status}`);
  }

  const parsed = await response.json() as { tokenPayloadExternal?: PlayIntegrityResponse };

  if (!parsed.tokenPayloadExternal) {
    throw new HttpError(400, 'Google Play Integrity response is missing token payload');
  }

  return parsed.tokenPayloadExternal;
}

function evaluatePlayIntegrityVerdict(
  verdict: PlayIntegrityResponse,
  challengeHash: string,
  clientDataHash?: string | null,
) {
  const requestNonce = verdict.requestDetails?.nonce;
  const packageName = verdict.appIntegrity?.packageName;
  const appVerdict = verdict.appIntegrity?.appRecognitionVerdict;
  const deviceVerdicts = verdict.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const hasDeviceIntegrity = deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY') ||
    deviceVerdicts.includes('MEETS_STRONG_INTEGRITY');

  if (!requestNonce || !doesPlayIntegrityNonceMatch(requestNonce, challengeHash, clientDataHash)) {
    return { reason: 'nonce_mismatch', status: 'UNTRUSTED' };
  }

  if (appVerdict === 'UNEVALUATED' || !appVerdict) {
    return { reason: 'app_integrity_unevaluated', status: 'UNTRUSTED' };
  }

  if (appVerdict !== 'PLAY_RECOGNIZED') {
    return { reason: 'app_not_play_recognized', status: 'UNTRUSTED' };
  }

  if (packageName !== config.GOOGLE_PACKAGE_NAME) {
    return { reason: 'package_name_mismatch', status: 'UNTRUSTED' };
  }

  if (!hasDeviceIntegrity) {
    return { reason: 'device_integrity_missing', status: 'UNTRUSTED' };
  }

  return { reason: null, status: 'TRUSTED' };
}

function doesPlayIntegrityNonceMatch(
  requestNonce: string,
  challengeHash: string,
  clientDataHash?: string | null,
) {
  // Google returns classic-request nonces as padded Base64, while the client
  // submits an unpadded Base64URL value. Compare the decoded challenge bytes;
  // retain the encoded-string comparison for records created by older servers.
  if (hashChallenge(requestNonce) === challengeHash) {
    return true;
  }

  if (!clientDataHash) {
    return false;
  }

  try {
    return crypto.createHash('sha256').update(base64UrlDecode(requestNonce)).digest('hex') === clientDataHash;
  } catch {
    return false;
  }
}

function getPlayIntegrityBuildNumber(verdict: PlayIntegrityResponse) {
  const buildNumber = Number(verdict.appIntegrity?.versionCode);

  return Number.isSafeInteger(buildNumber) && buildNumber > 0 ? buildNumber : undefined;
}

async function getGoogleAccessToken(scope: string) {
  const serviceAccount = await readGoogleServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64UrlEncode(Buffer.from(JSON.stringify({
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
    iss: serviceAccount.client_email,
    scope,
  })));
  const unsignedToken = `${header}.${claim}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsignedToken).sign(serviceAccount.private_key);
  const jwt = `${unsignedToken}.${base64UrlEncode(signature)}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      assertion: jwt,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError(500, `Google service account auth failed with ${response.status}`);
  }

  const tokenResponse = await response.json() as { access_token?: string };

  if (!tokenResponse.access_token) {
    throw new HttpError(500, 'Google service account auth did not return an access token');
  }

  return tokenResponse.access_token;
}

async function readGoogleServiceAccount(): Promise<GoogleServiceAccount> {
  const raw = config.GOOGLE_SERVICE_ACCOUNT_JSON
    ?? (config.GOOGLE_SERVICE_ACCOUNT_PATH ? await fs.readFile(config.GOOGLE_SERVICE_ACCOUNT_PATH, 'utf8') : null);

  if (!raw) {
    throw new HttpError(500, 'Google service account is not configured');
  }

  const parsed = JSON.parse(raw) as GoogleServiceAccount;

  if (!parsed.client_email || !parsed.private_key) {
    throw new HttpError(500, 'Google service account is invalid');
  }

  return parsed;
}

function hasGoogleServiceAccountConfig() {
  return !!config.GOOGLE_SERVICE_ACCOUNT_JSON || !!config.GOOGLE_SERVICE_ACCOUNT_PATH;
}

function hashChallenge(challenge: string) {
  return crypto.createHash('sha256').update(challenge).digest('hex');
}

function hashBase64UrlChallengeBytes(challenge: string) {
  return crypto.createHash('sha256').update(base64UrlDecode(challenge)).digest('hex');
}

function base64UrlEncode(input: Buffer) {
  return input
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string) {
  const normalized = input
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - normalized.length % 4) % 4)}`;

  return Buffer.from(padded, 'base64');
}

// TODO-MEETVAP-REMOVE-LEGACY-ATTESTATION:
// After Android/iOS builds that send app-attestation capability are mandatory,
// switch config.attestation.mode to enforce and remove old-client observe logic.
