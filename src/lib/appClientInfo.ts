import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const MAX_HEADER_VALUE_LENGTH = 64;
const CLIENT_CAPABILITIES = ['livekit-pool', 'app-attestation'];
const INSTALLATION_ID_STORAGE_KEY = 'meetvap.clientInstallationId.v1';
let cachedInstallationId: string | null = null;
let installationIdRequest: Promise<string> | null = null;

export async function initializeClientInstallationId() {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }

  if (installationIdRequest) {
    return installationIdRequest;
  }

  installationIdRequest = (async () => {
    const storedInstallationId = normalizeInstallationId(
      await AsyncStorage.getItem(INSTALLATION_ID_STORAGE_KEY).catch(() => null),
    );

    if (storedInstallationId) {
      cachedInstallationId = storedInstallationId;
      return storedInstallationId;
    }

    const installationId = createInstallationId();
    cachedInstallationId = installationId;
    await AsyncStorage.setItem(INSTALLATION_ID_STORAGE_KEY, installationId).catch(() => undefined);
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
  const appVersion = normalizeHeaderValue(Constants.nativeApplicationVersion ?? Constants.expoConfig?.version);
  const buildNumber = normalizeBuildNumber(Constants.nativeBuildVersion);

  if (appVersion) {
    headers['X-MeetVap-App-Version'] = appVersion;
  }

  if (buildNumber) {
    headers['X-MeetVap-Build-Number'] = buildNumber;
  }

  if (cachedInstallationId) {
    headers['X-MeetVap-Installation-Id'] = cachedInstallationId;
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
