import { getRemoteDiagnosticsConfig, uploadRemoteDiagnostics } from './backend';
import { getServerUrl } from './storage';

export const MESSAGE_DELIVERY_DIAGNOSTICS_ENABLED = false;
const REMOTE_DIAGNOSTIC_FALLBACK_UPLOAD_INTERVAL_MS = 20_000;
const REMOTE_DIAGNOSTIC_FALLBACK_MAX_BATCH_SIZE = 80;
const REMOTE_DIAGNOSTIC_MAX_BUFFER_SIZE = 500;

type RemoteDiagnosticEntry = {
  at: string;
  details: Record<string, unknown>;
  event: string;
  scope: RemoteDiagnosticScope;
};

type RemoteDiagnosticScope = 'call' | 'message';

let remoteMessageDiagnosticsEnabled = false;
let remoteCallDiagnosticsEnabled = false;
let remoteDiagnosticsMaxBatchSize = REMOTE_DIAGNOSTIC_FALLBACK_MAX_BATCH_SIZE;
let remoteDiagnosticsUploadIntervalMs = REMOTE_DIAGNOSTIC_FALLBACK_UPLOAD_INTERVAL_MS;
let remoteDiagnosticBuffer: RemoteDiagnosticEntry[] = [];
let remoteDiagnosticFlushTimer: ReturnType<typeof setTimeout> | null = null;
let remoteDiagnosticFlushInFlight: Promise<void> | null = null;

export function logMessageDeliveryDiagnostic(event: string, details: Record<string, unknown> = {}) {
  const entry: RemoteDiagnosticEntry = {
    at: new Date().toISOString(),
    details: sanitizeRemoteDiagnosticDetails(details),
    event,
    scope: 'message',
  };

  if (!MESSAGE_DELIVERY_DIAGNOSTICS_ENABLED) {
    queueRemoteMessageDeliveryDiagnostic(entry);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[MeetVapMessageDelivery] ${JSON.stringify({
      at: entry.at,
      event,
      ...details,
    })}`);
    queueRemoteMessageDeliveryDiagnostic(entry);
  }
}

export function logCallDiagnostic(event: string, details: Record<string, unknown> = {}) {
  if (!remoteCallDiagnosticsEnabled) {
    return;
  }

  queueRemoteDiagnostic({
    at: new Date().toISOString(),
    details: sanitizeRemoteDiagnosticDetails(details),
    event,
    scope: 'call',
  });
}

export async function refreshRemoteMessageDeliveryDiagnostics() {
  const serverUrl = await getServerUrl();

  if (!serverUrl) {
    setRemoteDiagnosticsEnabled({ call: false, message: false });
    return false;
  }

  try {
    const config = await getRemoteDiagnosticsConfig(serverUrl);

    remoteDiagnosticsMaxBatchSize = Math.max(1, Math.min(100, Math.floor(config.maxBatchSize ?? REMOTE_DIAGNOSTIC_FALLBACK_MAX_BATCH_SIZE)));
    remoteDiagnosticsUploadIntervalMs = Math.max(5000, Math.min(120_000, Math.floor((config.uploadIntervalSeconds ?? 20) * 1000)));
    setRemoteDiagnosticsEnabled({
      call: config.callEnabled === true,
      message: (config.messageEnabled ?? config.enabled) === true,
    });

    if (remoteMessageDiagnosticsEnabled) {
      logMessageDeliveryDiagnostic('remote-diagnostics-enabled', {
        maxBatchSize: remoteDiagnosticsMaxBatchSize,
        uploadIntervalMs: remoteDiagnosticsUploadIntervalMs,
      });
    }

    if (remoteCallDiagnosticsEnabled) {
      logCallDiagnostic('remote-call-diagnostics-enabled', {
        maxBatchSize: remoteDiagnosticsMaxBatchSize,
        uploadIntervalMs: remoteDiagnosticsUploadIntervalMs,
      });
    }

    return remoteMessageDiagnosticsEnabled || remoteCallDiagnosticsEnabled;
  } catch {
    setRemoteDiagnosticsEnabled({ call: false, message: false });
    return false;
  }
}

export function isRemoteMessageDeliveryDiagnosticsEnabled() {
  return remoteMessageDiagnosticsEnabled;
}

export function isRemoteCallDiagnosticsEnabled() {
  return remoteCallDiagnosticsEnabled;
}

export function flushRemoteMessageDeliveryDiagnostics() {
  return flushRemoteDiagnostics();
}

function setRemoteDiagnosticsEnabled(enabled: { call: boolean; message: boolean }) {
  remoteCallDiagnosticsEnabled = enabled.call;
  remoteMessageDiagnosticsEnabled = enabled.message;
  remoteDiagnosticBuffer = remoteDiagnosticBuffer.filter((entry) => isScopeEnabled(entry.scope));

  if (!remoteCallDiagnosticsEnabled && !remoteMessageDiagnosticsEnabled) {
    if (remoteDiagnosticFlushTimer) {
      clearTimeout(remoteDiagnosticFlushTimer);
      remoteDiagnosticFlushTimer = null;
    }
    remoteDiagnosticBuffer = [];
  }
}

function queueRemoteMessageDeliveryDiagnostic(entry: RemoteDiagnosticEntry) {
  queueRemoteDiagnostic(entry);
}

function queueRemoteDiagnostic(entry: RemoteDiagnosticEntry) {
  if (!isScopeEnabled(entry.scope)) {
    return;
  }

  remoteDiagnosticBuffer.push(entry);

  if (remoteDiagnosticBuffer.length > REMOTE_DIAGNOSTIC_MAX_BUFFER_SIZE) {
    remoteDiagnosticBuffer = remoteDiagnosticBuffer.slice(-REMOTE_DIAGNOSTIC_MAX_BUFFER_SIZE);
  }

  if (remoteDiagnosticBuffer.length >= remoteDiagnosticsMaxBatchSize) {
    void flushRemoteDiagnostics();
    return;
  }

  scheduleRemoteDiagnosticsFlush();
}

function scheduleRemoteDiagnosticsFlush() {
  if (remoteDiagnosticFlushTimer) {
    return;
  }

  remoteDiagnosticFlushTimer = setTimeout(() => {
    remoteDiagnosticFlushTimer = null;
    void flushRemoteDiagnostics();
  }, remoteDiagnosticsUploadIntervalMs);
}

async function flushRemoteDiagnostics() {
  if ((!remoteMessageDiagnosticsEnabled && !remoteCallDiagnosticsEnabled) || remoteDiagnosticBuffer.length === 0) {
    return;
  }

  if (remoteDiagnosticFlushInFlight) {
    return remoteDiagnosticFlushInFlight;
  }

  remoteDiagnosticFlushInFlight = (async () => {
    const serverUrl = await getServerUrl();

    if (!serverUrl) {
      return;
    }

    const entries = remoteDiagnosticBuffer.splice(0, remoteDiagnosticsMaxBatchSize);

    try {
      const response = await uploadRemoteDiagnostics(serverUrl, entries);

      if (!response.accepted) {
        setRemoteDiagnosticsEnabled({ call: false, message: false });
        return;
      }

      if (remoteDiagnosticBuffer.length > 0) {
        scheduleRemoteDiagnosticsFlush();
      }
    } catch {
      remoteDiagnosticBuffer = [...entries, ...remoteDiagnosticBuffer].slice(-REMOTE_DIAGNOSTIC_MAX_BUFFER_SIZE);
      scheduleRemoteDiagnosticsFlush();
    }
  })().finally(() => {
    remoteDiagnosticFlushInFlight = null;
  });

  return remoteDiagnosticFlushInFlight;
}

function isScopeEnabled(scope: RemoteDiagnosticScope) {
  return scope === 'call' ? remoteCallDiagnosticsEnabled : remoteMessageDiagnosticsEnabled;
}

function sanitizeRemoteDiagnosticDetails(details: Record<string, unknown>) {
  return sanitizeRemoteDiagnosticValue(details, 0) as Record<string, unknown>;
}

function sanitizeRemoteDiagnosticValue(value: unknown, depth: number): unknown {
  if (depth > 6) {
    return '[depth-limit]';
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...[truncated]` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitizeRemoteDiagnosticValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};

    Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, item]) => {
      output[key.slice(0, 120)] = sanitizeRemoteDiagnosticValue(item, depth + 1);
    });

    return output;
  }

  return String(value);
}
