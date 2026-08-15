import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getNativeAppBuildNumber, getNativeAppVersion } from '../native/CallNative';

const MAX_HEADER_VALUE_LENGTH = 64;
const CLIENT_CAPABILITIES = ['livekit-pool', 'app-attestation'];
const INSTALLATION_ID_STORAGE_KEY = 'meetvap.clientInstallationId.v1';
let cachedInstallationId: string | null = null;
let installationIdRequest: Promise<string> | null = null;
let cachedNativeAppVersion: string | null = null;
let cachedNativeBuildNumber: string | null = null;
let hasInitializedNativeMetadata = false;

export async function initializeClientInstallationId() {
  if (cachedInstallationId && hasInitializedNativeMetadata) {
    return cachedInstallationId;
  }

  if (installationIdRequest) {
    return installationIdRequest;
  }

  installationIdRequest = (async () => {
    const nativeMetadataPromise = Promise.all([
      getNativeAppVersion(),
      getNativeAppBuildNumber(),
    ]).then(([appVersion, buildNumber]) => {
      cachedNativeAppVersion = normalizeHeaderValue(appVersion) ?? null;
      cachedNativeBuildNumber = normalizeBuildNumber(buildNumber) ?? null;
      hasInitializedNativeMetadata = true;
    });
    const storedInstallationId = normalizeInstallationId(
      await AsyncStorage.getItem(INSTALLATION_ID_STORAGE_KEY).catch(() => null),
    );

    if (storedInstallationId) {
      cachedInstallationId = storedInstallationId;
      await nativeMetadataPromise;
      return storedInstallationId;
    }

    const installationId = createInstallationId();
    cachedInstallationId = installationId;
    await Promise.all([
      AsyncStorage.setItem(INSTALLATION_ID_STORAGE_KEY, installationId).catch(() => undefined),
      nativeMetadataPromise,
    ]);
    return installationId;
  })().finally(() => {
    installationIdRequest = null;
  });

  return installationIdRequest;
}

export function getClientRequestHeaders() {
  const headers: Record<string, string> = {
    'X-MeetVap-Capabilities': CLIENT_CAPABILITIES.join(','),
    'X-MeetVap-Platform': Platform.OS,
  };
  const appVersion = cachedNativeAppVersion;
  const buildNumber = cachedNativeBuildNumber;
  const deviceModel = normalizeHeaderValue(Device.modelName);
  const osVersion = normalizeHeaderValue(Device.osVersion);

  if (appVersion) {
    headers['X-MeetVap-App-Version'] = appVersion;
  }

  if (buildNumber) {
    headers['X-MeetVap-Build-Number'] = buildNumber;
  }

  if (cachedInstallationId) {
    headers['X-MeetVap-Installation-Id'] = cachedInstallationId;
  }

  if (deviceModel) {
    headers['X-MeetVap-Device-Model'] = deviceModel;
  }

  if (osVersion) {
    headers['X-MeetVap-OS-Version'] = osVersion;
  }

  return headers;
}

function createInstallationId() {
  const randomPart = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');

  return normalizeInstallationId(`${Date.now().toString(36)}-${randomPart}`) ?? `${Date.now()}-mobile`;
}

function normalizeInstallationId(value?: string | null) {
  const normalized = value?.trim();

  return normalized && /^[A-Za-z0-9._-]{16,64}$/.test(normalized) ? normalized : null;
}

function normalizeHeaderValue(value?: string | null) {
  const normalized = value?.trim();

  return normalized ? normalized.slice(0, MAX_HEADER_VALUE_LENGTH) : undefined;
}

function normalizeBuildNumber(value?: string | null) {
  const normalized = normalizeHeaderValue(value);

  if (!normalized || !/^\d+$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}
