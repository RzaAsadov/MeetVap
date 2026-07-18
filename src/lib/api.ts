import { getAuthToken } from './storage';
import { t } from '../i18n';
import { getClientRequestHeaders, initializeClientInstallationId } from './appClientInfo';
import { MASK_HEADER, MASK_VERSION, maskPayload, unmaskPayload } from './payloadMask';

type RequestOptions = RequestInit & {
  maskBody?: boolean;
  serverUrl: string;
};

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const MEETVAP_PROHIBITED_NAME_MESSAGE = 'Using "MeetVap" is prohibited by system';
const OBJECTIONABLE_CONTENT_MESSAGE = 'This content is not allowed by MeetVap community rules';

export async function apiRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const { maskBody: _maskBody, serverUrl, ...fetchOptions } = options;
  const token = await getAuthToken();
  await initializeClientInstallationId();
  const headers = new Headers(options.headers);
  Object.entries(getClientRequestHeaders()).forEach(([key, value]) => {
    headers.set(key, value);
  });
  const shouldMaskBody = options.maskBody !== false && typeof options.body === 'string' && !isMediaUploadPath(path);
  const body = shouldMaskBody && typeof options.body === 'string'
    ? JSON.stringify({ payload: maskPayload(JSON.parse(options.body)) })
    : options.body;

  headers.set('Accept', 'application/json');

  if (shouldMaskBody) {
    headers.set(MASK_HEADER, MASK_VERSION);
  }

  if (body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${serverUrl}${path}`, {
    ...fetchOptions,
    body,
    headers,
  });

  const responseText = await response.text();
  const parsedResponse = parseApiResponseText(responseText, response.headers.get(MASK_HEADER));

  if (!response.ok) {
    let parsedError: string | undefined;

    if (parsedResponse && typeof parsedResponse === 'object' && 'error' in parsedResponse) {
      const parsed = parsedResponse as { error?: string };
      parsedError = getLocalizedApiError(parsedResponse) ?? parsed.error;
    }

    const responseCode = parsedResponse && typeof parsedResponse === 'object' && 'code' in parsedResponse && typeof parsedResponse.code === 'string'
      ? parsedResponse.code
      : undefined;
    const retryAfterSeconds = parsedResponse && typeof parsedResponse === 'object' && 'retryAfterSeconds' in parsedResponse && typeof parsedResponse.retryAfterSeconds === 'number'
      ? parsedResponse.retryAfterSeconds
      : undefined;
    throw new ApiError(
      (getLocalizedStructuredApiError(responseCode, retryAfterSeconds) ?? parsedError) || responseText || `Request failed with ${response.status}`,
      response.status,
      responseCode,
      retryAfterSeconds,
    );
  }

  return parsedResponse as T;
}

function getLocalizedStructuredApiError(code?: string, retryAfterSeconds?: number) {
  if (code === 'RATE_LIMITED') {
    return t('sendCooldown', { seconds: retryAfterSeconds ?? 60 });
  }

  if (code === 'ATTACHMENT_TOO_LARGE') {
    return t('attachmentTooLarge');
  }

  if (code === 'ATTACHMENT_BATCH_TOO_LARGE') {
    return t('attachmentBatchTooLarge');
  }

  if (code === 'CONTACTS_ONLY_CALLS') {
    return t('contactsOnlyCallsBlocked');
  }

  if (code === 'REDEEM_CODE_REQUIRED') {
    return t('subscriptionRedeemEmptyCode');
  }

  if (code === 'REDEEM_CODE_INVALID') {
    return t('subscriptionRedeemInvalid');
  }

  if (code === 'REDEEM_CODE_DISABLED') {
    return t('subscriptionRedeemDisabled');
  }

  if (code === 'REDEEM_CODE_USED_UP') {
    return t('subscriptionRedeemUsedUp');
  }

  if (code === 'REDEEM_CODE_ALREADY_USED') {
    return t('subscriptionRedeemAlreadyUsed');
  }
}

function getLocalizedApiError(parsedResponse: object) {
  const error = 'error' in parsedResponse && typeof parsedResponse.error === 'string'
    ? parsedResponse.error
    : undefined;
  const issueMessage = getFirstValidationIssueMessage(parsedResponse);
  const message = issueMessage ?? error;

  if (message === MEETVAP_PROHIBITED_NAME_MESSAGE) {
    return t('meetvapNameProhibited');
  }

  if (message === OBJECTIONABLE_CONTENT_MESSAGE) {
    return t('objectionableContentNotAllowed');
  }

  return issueMessage;
}

function getFirstValidationIssueMessage(parsedResponse: object) {
  if (!('issues' in parsedResponse) || !Array.isArray(parsedResponse.issues)) {
    return undefined;
  }

  const firstIssue = parsedResponse.issues.find((issue) => (
    issue &&
    typeof issue === 'object' &&
    'message' in issue &&
    typeof issue.message === 'string'
  ));

  return firstIssue && typeof firstIssue === 'object' && 'message' in firstIssue
    ? firstIssue.message
    : undefined;
}

function isMediaUploadPath(path: string) {
  return path === '/media/upload' || path === '/media/upload-binary' || path.startsWith('/media/uploads/');
}

function parseApiResponseText(text: string, maskHeader: string | null) {
  if (!text) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return text;
  }

  if (maskHeader === MASK_VERSION && parsed && typeof parsed === 'object' && 'payload' in parsed && typeof parsed.payload === 'string') {
    return unmaskPayload(parsed.payload);
  }

  return parsed;
}

export async function validateServerUrl(rawUrl: string) {
  const serverUrl = rawUrl.trim().replace(/\/+$/, '');

  if (!/^https?:\/\/.+/i.test(serverUrl)) {
    throw new Error(t('serverUrlHttpRequired'));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(t('serverHealthCheckFailed'));
    }

    return serverUrl;
  } finally {
    clearTimeout(timeout);
  }
}
