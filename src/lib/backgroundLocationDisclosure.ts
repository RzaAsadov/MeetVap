import { getStoredBackgroundLocationDisclosureVersion, setStoredBackgroundLocationDisclosureVersion } from './storage';

export const CURRENT_BACKGROUND_LOCATION_DISCLOSURE_VERSION = 1;

type DisclosureListener = () => void;

let activeRequest: {
  promise: Promise<boolean>;
  resolve: (didConsent: boolean) => void;
} | null = null;
const listeners = new Set<DisclosureListener>();

export async function hasAcceptedCurrentBackgroundLocationDisclosure() {
  return await getStoredBackgroundLocationDisclosureVersion() === CURRENT_BACKGROUND_LOCATION_DISCLOSURE_VERSION;
}

export async function markCurrentBackgroundLocationDisclosureAccepted() {
  await setStoredBackgroundLocationDisclosureVersion(CURRENT_BACKGROUND_LOCATION_DISCLOSURE_VERSION);
}

export function requestBackgroundLocationDisclosureConsent() {
  if (activeRequest) {
    return activeRequest.promise;
  }

  let resolveRequest: (didConsent: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    resolveRequest = resolve;
  });

  activeRequest = {
    promise,
    resolve: resolveRequest,
  };
  notifyListeners();
  return promise;
}

export function respondToBackgroundLocationDisclosure(didConsent: boolean) {
  const request = activeRequest;

  if (!request) {
    return;
  }

  activeRequest = null;
  request.resolve(didConsent);
  notifyListeners();
}

export function subscribeToBackgroundLocationDisclosure(listener: DisclosureListener) {
  listeners.add(listener);
  listener();

  return () => {
    listeners.delete(listener);
  };
}

export function isBackgroundLocationDisclosureRequested() {
  return activeRequest !== null;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}
