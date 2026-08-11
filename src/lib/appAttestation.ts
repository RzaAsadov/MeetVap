import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { ApiError } from './api';
import {
  createAttestationChallenge,
  submitAndroidPlayIntegrityAttestation,
  submitIosAppAttestAssertion,
  submitIosAppAttestRegistration,
} from './backend';
import {
  attestNativeAppAttestKey,
  generateNativeAppAttestAssertion,
  generateNativeAppAttestKey,
  requestNativePlayIntegrityToken,
} from '../native/CallNative';

const ATTESTATION_RUN_INTERVAL_MS = 20 * 60 * 60 * 1000;
const LAST_RUN_PREFIX = 'messenger.appAttestation.lastRun.';
const IOS_APP_ATTEST_KEY_PREFIX = 'messenger.appAttestation.iosKey.';

export type AppAttestationRunResult = {
  nextRunAfterSeconds: number;
};

const inFlightRuns = new Map<string, Promise<AppAttestationRunResult | undefined>>();

export async function runAppAttestation(serverUrl: string, userId: string) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  const runKey = getAttestationScope(serverUrl, userId);
  const existingRun = inFlightRuns.get(runKey);

  if (existingRun) {
    return existingRun;
  }

  const run = runAppAttestationInternal(serverUrl, userId)
    .catch((error) => {
      if (error instanceof ApiError && error.code === 'ATTESTATION_RETRY_REQUIRED') {
        return { nextRunAfterSeconds: error.retryAfterSeconds ?? 300 };
      }

      return {
        nextRunAfterSeconds: error instanceof AttestationRetryError
          ? error.retryAfterSeconds
          : 300,
      };
    })
    .finally(() => {
      inFlightRuns.delete(runKey);
    });
  inFlightRuns.set(runKey, run);

  return run;
}

async function runAppAttestationInternal(
  serverUrl: string,
  userId: string,
): Promise<AppAttestationRunResult | undefined> {
  const lastRunKey = `${LAST_RUN_PREFIX}${getAttestationScope(serverUrl, userId)}`;
  const lastRun = Number(await AsyncStorage.getItem(lastRunKey).catch(() => null));
  const elapsedSinceLastRun = Date.now() - lastRun;

  if (Number.isFinite(lastRun) && elapsedSinceLastRun < ATTESTATION_RUN_INTERVAL_MS) {
    return {
      nextRunAfterSeconds: Math.max(30, Math.ceil((ATTESTATION_RUN_INTERVAL_MS - elapsedSinceLastRun) / 1000)),
    };
  }

  if (Platform.OS === 'android') {
    await runAndroidPlayIntegrityAttestation(serverUrl);
  } else {
    await runIosAppAttestRegistration(serverUrl, userId);
  }

  await AsyncStorage.setItem(lastRunKey, String(Date.now())).catch(() => undefined);
  return { nextRunAfterSeconds: ATTESTATION_RUN_INTERVAL_MS / 1000 };
}

async function runAndroidPlayIntegrityAttestation(serverUrl: string) {
  const challenge = await createAttestationChallenge(serverUrl, {
    platform: 'android',
    provider: 'play-integrity',
  });
  const token = await requestNativePlayIntegrityToken(challenge.challenge);

  if (!token) {
    throw new AttestationRetryError(challenge.retryAfterSeconds ?? 300);
  }

  await submitAndroidPlayIntegrityAttestation(serverUrl, {
    challengeId: challenge.challengeId,
    token,
  });
}

async function runIosAppAttestRegistration(serverUrl: string, userId: string) {
  const keyStorageKey = `${IOS_APP_ATTEST_KEY_PREFIX}${getAttestationScope(serverUrl, userId)}`;
  const legacyKeyStorageKey = `${IOS_APP_ATTEST_KEY_PREFIX}${userId}`;
  await AsyncStorage.removeItem(legacyKeyStorageKey).catch(() => undefined);
  const existingKeyId = await AsyncStorage.getItem(keyStorageKey).catch(() => null);

  if (existingKeyId) {
    try {
      await runIosAppAttestAssertion(serverUrl, existingKeyId);
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'APP_ATTEST_KEY_NOT_REGISTERED') {
        throw error;
      }

      await AsyncStorage.removeItem(keyStorageKey).catch(() => undefined);
    }
  }

  const keyId = await generateNativeAppAttestKey();

  if (!keyId) {
    throw new AttestationRetryError(300);
  }

  const challenge = await createAttestationChallenge(serverUrl, {
    keyId,
    platform: 'ios',
    purpose: 'registration',
    provider: 'app-attest',
  });
  const attestationObject = await attestNativeAppAttestKey(keyId, challenge.challenge);

  if (!attestationObject) {
    throw new AttestationRetryError(challenge.retryAfterSeconds ?? 300);
  }

  const result = await submitIosAppAttestRegistration(serverUrl, {
    attestationObject,
    challengeId: challenge.challengeId,
    keyId,
  });

  if (result.status !== 'TRUSTED') {
    throw new AttestationRetryError(challenge.retryAfterSeconds ?? 300);
  }

  await AsyncStorage.setItem(keyStorageKey, keyId);
}

async function runIosAppAttestAssertion(serverUrl: string, keyId: string) {
  const challenge = await createAttestationChallenge(serverUrl, {
    keyId,
    platform: 'ios',
    purpose: 'assertion',
    provider: 'app-attest',
  });
  const assertionObject = await generateNativeAppAttestAssertion(keyId, challenge.challenge);

  if (!assertionObject) {
    throw new AttestationRetryError(challenge.retryAfterSeconds ?? 300);
  }

  const result = await submitIosAppAttestAssertion(serverUrl, {
    assertionObject,
    challengeId: challenge.challengeId,
    keyId,
  });

  if (result.status !== 'TRUSTED') {
    throw new AttestationRetryError(challenge.retryAfterSeconds ?? 300);
  }
}

class AttestationRetryError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('App attestation should be retried');
    this.name = 'AttestationRetryError';
  }
}

function getAttestationScope(serverUrl: string, userId: string) {
  return `${encodeURIComponent(serverUrl.trim().toLowerCase())}.${Platform.OS}.${userId}`;
}
