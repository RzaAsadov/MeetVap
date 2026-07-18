import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import {
  createAttestationChallenge,
  submitAndroidPlayIntegrityAttestation,
  submitIosAppAttestRegistration,
} from './backend';
import {
  attestNativeAppAttestKey,
  generateNativeAppAttestKey,
  requestNativePlayIntegrityToken,
} from '../native/CallNative';

const ATTESTATION_RUN_INTERVAL_MS = 20 * 60 * 60 * 1000;
const LAST_RUN_PREFIX = 'messenger.appAttestation.lastRun.';
const IOS_APP_ATTEST_KEY_PREFIX = 'messenger.appAttestation.iosKey.';

let inFlightRun: Promise<void> | null = null;

export async function runAppAttestation(serverUrl: string, userId: string) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  if (inFlightRun) {
    return inFlightRun;
  }

  inFlightRun = runAppAttestationInternal(serverUrl, userId)
    .catch(() => undefined)
    .finally(() => {
      inFlightRun = null;
    });

  return inFlightRun;
}

async function runAppAttestationInternal(serverUrl: string, userId: string) {
  const lastRunKey = `${LAST_RUN_PREFIX}${Platform.OS}.${userId}`;
  const lastRun = Number(await AsyncStorage.getItem(lastRunKey).catch(() => null));

  if (Number.isFinite(lastRun) && Date.now() - lastRun < ATTESTATION_RUN_INTERVAL_MS) {
    return;
  }

  if (Platform.OS === 'android') {
    await runAndroidPlayIntegrityAttestation(serverUrl);
  } else {
    await runIosAppAttestRegistration(serverUrl, userId);
  }

  await AsyncStorage.setItem(lastRunKey, String(Date.now())).catch(() => undefined);
}

async function runAndroidPlayIntegrityAttestation(serverUrl: string) {
  const challenge = await createAttestationChallenge(serverUrl, {
    platform: 'android',
    provider: 'play-integrity',
  });
  const token = await requestNativePlayIntegrityToken(challenge.challenge);

  if (!token) {
    return;
  }

  await submitAndroidPlayIntegrityAttestation(serverUrl, {
    challengeId: challenge.challengeId,
    token,
  });
}

async function runIosAppAttestRegistration(serverUrl: string, userId: string) {
  const keyStorageKey = `${IOS_APP_ATTEST_KEY_PREFIX}${userId}`;
  const existingKeyId = await AsyncStorage.getItem(keyStorageKey).catch(() => null);
  const keyId = existingKeyId || await generateNativeAppAttestKey();

  if (!keyId) {
    return;
  }

  if (!existingKeyId) {
    await AsyncStorage.setItem(keyStorageKey, keyId).catch(() => undefined);
  }

  const challenge = await createAttestationChallenge(serverUrl, {
    platform: 'ios',
    provider: 'app-attest',
  });
  const attestationObject = await attestNativeAppAttestKey(keyId, challenge.challenge);

  if (!attestationObject) {
    return;
  }

  await submitIosAppAttestRegistration(serverUrl, {
    attestationObject,
    challengeId: challenge.challengeId,
    keyId,
  });
}
