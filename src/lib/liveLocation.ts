import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { t } from '../i18n';
import {
  hasAcceptedCurrentBackgroundLocationDisclosure,
  markCurrentBackgroundLocationDisclosureAccepted,
  requestBackgroundLocationDisclosureConsent,
} from './backgroundLocationDisclosure';
import { stopLiveLocation, updateLiveLocation } from './backend';
import { listActiveLiveLocationShares, removeActiveLiveLocationShare, saveActiveLiveLocationShare } from './messageStore';
import { emitSecurityEvent } from './securityEvents';
import { getServerUrl, getStoredErasePinAlertConfig, setStoredErasePinAlertConfig } from './storage';

const LIVE_LOCATION_TASK = 'meetvap-live-location';
const UPDATE_INTERVAL_MS = 60 * 1000;
export const LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS = 30 * 1000;
let liveLocationPermissionRequest: Promise<boolean> | null = null;

TaskManager.defineTask(LIVE_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data || typeof data !== 'object' || !('locations' in data) || !Array.isArray(data.locations)) {
    return;
  }

  if (!await hasLiveLocationBackgroundAuthorization()) {
    await stopLiveLocationTask().catch(() => undefined);
    return;
  }

  const location = data.locations.at(-1) as Location.LocationObject | undefined;

  if (location) {
    await pushLiveLocationUpdate(location.coords).catch(() => undefined);
  }
});

export function requestLiveLocationPermissions() {
  if (liveLocationPermissionRequest) {
    return liveLocationPermissionRequest;
  }

  const request = performLiveLocationPermissionRequest().finally(() => {
    if (liveLocationPermissionRequest === request) {
      liveLocationPermissionRequest = null;
    }
  });
  liveLocationPermissionRequest = request;
  return request;
}

async function performLiveLocationPermissionRequest() {
  if (Platform.OS === 'android') {
    return requestAndroidLiveLocationPermissions();
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    return false;
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted;
}

async function requestAndroidLiveLocationPermissions() {
  const [existingForeground, existingBackground, hasCurrentDisclosure] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    hasAcceptedCurrentBackgroundLocationDisclosure(),
  ]);

  if (!hasCurrentDisclosure || !existingForeground.granted || !existingBackground.granted) {
    const didConsent = await requestBackgroundLocationDisclosureConsent();

    if (!didConsent) {
      return false;
    }
  }

  const foreground = existingForeground.granted
    ? existingForeground
    : await Location.requestForegroundPermissionsAsync();

  if (!foreground.granted) {
    return false;
  }

  if (!existingBackground.granted) {
    await Location.requestBackgroundPermissionsAsync();
  }

  const background = await Location.getBackgroundPermissionsAsync();

  if (!background.granted) {
    return false;
  }

  await markCurrentBackgroundLocationDisclosureAccepted();
  return true;
}

export async function hasActiveLiveLocationShare() {
  const shares = await listActiveLiveLocationShares();
  return shares.length > 0;
}

export async function registerLiveLocationShare(share: { expiresAt: string; id: string }) {
  await saveActiveLiveLocationShare(share);
  const didStartTracking = await ensureLiveLocationTracking();

  if (!didStartTracking) {
    await removeActiveLiveLocationShare(share.id);
    throw new Error(t('backgroundLocationUnavailable'));
  }
}

export async function stopTrackedLiveLocationShare(id: string) {
  const serverUrl = await getServerUrl();
  await stopLiveLocation(serverUrl, id);
  await removeActiveLiveLocationShare(id);
  await stopTrackingWhenIdle();
}

export async function ensureLiveLocationTracking() {
  const shares = await listActiveLiveLocationShares();
  const hasStartedUpdates = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);

  if (shares.length === 0) {
    if (hasStartedUpdates) {
      await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
    }
    return true;
  }

  if (hasStartedUpdates) {
    if (await hasLiveLocationBackgroundAuthorization()) {
      return true;
    }

    await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
    return false;
  }

  if (!await hasLiveLocationBackgroundAuthorization()) {
    return false;
  }

  await Location.startLocationUpdatesAsync(LIVE_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    activityType: Location.ActivityType.Other,
    distanceInterval: 25,
    foregroundService: Platform.OS === 'android'
      ? {
          notificationBody: t('liveLocationBackgroundNotification'),
          notificationTitle: t('liveLocation'),
        }
      : undefined,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    timeInterval: UPDATE_INTERVAL_MS,
  });
  return true;
}

export async function hasLiveLocationBackgroundAuthorization() {
  const [foreground, background, hasCurrentDisclosure] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Platform.OS === 'android'
      ? hasAcceptedCurrentBackgroundLocationDisclosure()
      : Promise.resolve(true),
  ]);

  return foreground.granted && background.granted && hasCurrentDisclosure;
}

export async function reconcileBackgroundLocationAccess() {
  if (Platform.OS !== 'android') {
    await ensureLiveLocationTracking();
    return;
  }

  const [shares, panicConfig] = await Promise.all([
    listActiveLiveLocationShares(),
    getStoredErasePinAlertConfig(),
  ]);
  const needsBackgroundLocation = shares.length > 0 || panicConfig?.sendLiveLocation === true;

  if (!needsBackgroundLocation) {
    await stopTrackingWhenIdle();
    return;
  }

  if (await requestLiveLocationPermissions()) {
    await ensureLiveLocationTracking();
    return;
  }

  await stopAllTrackedLiveLocationShares(shares.map((share) => share.id));

  if (panicConfig?.sendLiveLocation === true) {
    await setStoredErasePinAlertConfig({
      ...panicConfig,
      sendLiveLocation: false,
    });
    emitSecurityEvent('backgroundLocationDisabled');
  }
}

async function pushLiveLocationUpdate(coords: Location.LocationObjectCoords) {
  const shares = await listActiveLiveLocationShares();
  const serverUrl = await getServerUrl();

  await Promise.allSettled(shares.map(async (share) => {
    try {
      await updateLiveLocation(serverUrl, share.id, {
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    } catch {
      if (new Date(share.expiresAt).getTime() <= Date.now()) {
        await removeActiveLiveLocationShare(share.id);
      }
    }
  }));
  await stopTrackingWhenIdle();
}

async function stopTrackingWhenIdle() {
  const shares = await listActiveLiveLocationShares();
  const hasStartedUpdates = await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK);

  if (shares.length === 0 && hasStartedUpdates) {
    await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
  }
}

async function stopAllTrackedLiveLocationShares(ids: string[]) {
  const serverUrl = await getServerUrl().catch(() => null);

  await Promise.allSettled(ids.map(async (id) => {
    if (serverUrl) {
      await stopLiveLocation(serverUrl, id).catch(() => undefined);
    }
    await removeActiveLiveLocationShare(id);
  }));
  await stopLiveLocationTask();
}

async function stopLiveLocationTask() {
  if (await Location.hasStartedLocationUpdatesAsync(LIVE_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LIVE_LOCATION_TASK);
  }
}
