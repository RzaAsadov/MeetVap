import crypto from 'crypto';
import fs from 'fs/promises';
import { Request, Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { getAuthedUser } from '../auth';
import { getRequestClientMetadata, hashAccessToken } from '../clientCompatibility';
import { config } from '../config';
import { HttpError } from '../httpError';
import { operationalConfig } from '../operationalConfig';
import { prisma } from '../prisma';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const VALID_PLATFORM_VALUES = ['android', 'ios'] as const;
const VALID_PROVIDER_VALUES = ['play-integrity', 'app-attest'] as const;

const challengeInputSchema = z.object({
  platform: z.enum(VALID_PLATFORM_VALUES),
  provider: z.enum(VALID_PROVIDER_VALUES).optional(),
});

const androidPlayIntegrityInputSchema = z.object({
  challengeId: z.string().min(1),
  token: z.string().min(20),
});

const iosAppAttestInputSchema = z.object({
  attestationObject: z.string().min(20),
  challengeId: z.string().min(1),
  keyId: z.string().min(10),
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
    const challenge = base64UrlEncode(crypto.randomBytes(32));
    const session = await getCurrentSession(req, currentUser.id);
    const expiresAt = new Date(Date.now() + operationalConfig.attestation.challengeTtlMinutes * 60_000);

    const row = await prisma.attestationChallenge.create({
      data: {
        challengeHash: hashChallenge(challenge),
        clientDataHash: hashBase64UrlChallengeBytes(challenge),
        expiresAt,
        platform: input.platform,
        provider,
        sessionId: session?.id ?? null,
        userId: currentUser.id,
      },
    });

    res.json({
      challenge,
      challengeId: row.id,
      expiresAt: expiresAt.toISOString(),
      mode: operationalConfig.attestation.mode,
      provider,
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
        status: operationalConfig.attestation.mode === 'enforce' ? 'FAILED' : 'PENDING',
        userId: currentUser.id,
        verdict: {
          mode: operationalConfig.attestation.mode,
          reason: 'Google Play Integrity service account or package name is not configured',
        },
      });

      res.json({ ok: true, status: attestation.status });
      return;
    }

    const verdict = await decodePlayIntegrityToken(input.token);
    const evaluation = evaluatePlayIntegrityVerdict(verdict, challenge.challenge);
    const attestation = await recordAttestation(req, {
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
    await consumeChallenge(req, currentUser.id, input.challengeId, 'ios', 'app-attest');

    const attestation = await recordAttestation(req, {
      challengeId: input.challengeId,
      deviceKeyId: input.keyId,
      failureReason: 'ios_app_attest_server_verification_pending',
      platform: 'ios',
      provider: 'app-attest',
      status: 'PENDING',
      userId: currentUser.id,
      verdict: {
        attestationObjectLength: input.attestationObject.length,
        mode: operationalConfig.attestation.mode,
        reason: 'App Attest artifact received; strict Apple attestation verification is intentionally not enforced during staged rollout.',
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
      mode: operationalConfig.attestation.mode,
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

  await prisma.attestationChallenge.update({
    data: { consumedAt: new Date() },
    where: { id: challenge.id },
  });

  return {
    ...challenge,
    challenge: challenge.challengeHash,
  };
}

async function recordAttestation(req: Request, input: {
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

  return prisma.deviceAttestation.create({
    data: {
      appBuildNumber: metadata.appBuildNumber ?? null,
      appVersion: metadata.appVersion ?? null,
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

function evaluatePlayIntegrityVerdict(verdict: PlayIntegrityResponse, challengeHash: string) {
  const requestNonce = verdict.requestDetails?.nonce;
  const packageName = verdict.appIntegrity?.packageName;
  const appVerdict = verdict.appIntegrity?.appRecognitionVerdict;
  const deviceVerdicts = verdict.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const hasDeviceIntegrity = deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY') ||
    deviceVerdicts.includes('MEETS_STRONG_INTEGRITY');

  if (!requestNonce || hashChallenge(requestNonce) !== challengeHash) {
    return { reason: 'nonce_mismatch', status: 'UNTRUSTED' };
  }

  if (packageName !== config.GOOGLE_PACKAGE_NAME) {
    return { reason: 'package_name_mismatch', status: 'UNTRUSTED' };
  }

  if (appVerdict !== 'PLAY_RECOGNIZED') {
    return { reason: 'app_not_play_recognized', status: 'UNTRUSTED' };
  }

  if (!hasDeviceIntegrity) {
    return { reason: 'device_integrity_missing', status: 'UNTRUSTED' };
  }

  return { reason: null, status: 'TRUSTED' };
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
