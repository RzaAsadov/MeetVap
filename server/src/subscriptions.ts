import crypto from 'crypto';
import fs from 'fs/promises';
import { NextFunction, Request, Response } from 'express';

import { getAuthedUser } from './auth';
import { config } from './config';
import { HttpError } from './httpError';
import { operationalConfig } from './operationalConfig';
import { prisma } from './prisma';

export const SUBSCRIPTION_PRODUCT_IDS = [
  'meetvap_monthly',
  'meetvap_3_month',
  'meetvap_6_month',
  'meetvap_yearly',
] as const;

const REDEEM_SUBSCRIPTION_PERIODS: Record<number, { productId: string }> = {
  1: { productId: 'redeem_1_month' },
  3: { productId: 'redeem_3_month' },
  6: { productId: 'redeem_6_month' },
  12: { productId: 'redeem_12_month' },
};
const ACTIVE_STATUSES = ['ACTIVE', 'GRACE'] as const;
const APPLE_PRODUCTION_VERIFY_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_VERIFY_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const DAY_MS = 24 * 60 * 60 * 1000;

type AppleReceiptResponse = {
  environment?: string;
  latest_receipt_info?: AppleReceiptInfo[];
  pending_renewal_info?: Array<{
    auto_renew_status?: string;
    original_transaction_id?: string;
    product_id?: string;
  }>;
  receipt?: {
    bundle_id?: string;
    in_app?: AppleReceiptInfo[];
  };
  status: number;
};

type AppleReceiptInfo = {
  cancellation_date_ms?: string;
  expires_date_ms?: string;
  original_transaction_id?: string;
  product_id?: string;
  transaction_id?: string;
};

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
};

type GoogleSubscriptionV2 = {
  acknowledgementState?: string;
  canceledStateContext?: unknown;
  lineItems?: Array<{
    expiryTime?: string;
    productId?: string;
  }>;
  subscriptionState?: string;
};

type RedeemCodeRow = {
  code: string;
  createdByAdminId: string | null;
  createdByAdminUsername: string | null;
  createdByPartnerId: string | null;
  createdByPartnerUsername: string | null;
  disabledAt: Date | null;
  durationMonths: number;
  id: string;
  maxUses: number;
  name: string;
  productId: string;
  usedCount: number;
};

export type SubscriptionStatusResponse = {
  entitlement: {
    environment: 'SANDBOX' | 'PRODUCTION';
    expiresAt: string;
    platform: 'IOS' | 'ANDROID' | 'MANUAL';
    productId: string;
    status: string;
    willRenew: boolean;
  } | null;
  hasActiveSubscription: boolean;
  hasPremiumAccess: boolean;
  premiumAccessSource: 'none' | 'subscription' | 'trial';
  premiumTrialDays: number;
  premiumTrialDaysRemaining: number;
  premiumTrialEndsAt: string | null;
  premiumTrialStartedAt: string | null;
};

export async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatusResponse> {
  if (config.SCREENSHOT_SUBSCRIPTION_BYPASS || await isSubscriptionBypassUser(userId)) {
    return createBypassSubscriptionStatus();
  }

  const [entitlement, trial] = await Promise.all([
    getLatestEntitlement(userId),
    getPremiumTrialStatus(userId),
  ]);
  const hasActiveSubscription = !!entitlement && isEntitlementActive(entitlement);
  const hasPremiumAccess = hasActiveSubscription || trial.isActive;

  if (!hasPremiumAccess) {
    await disableExpiredPremiumFeatures(userId);
  }

  return {
    entitlement: entitlement
      ? {
          environment: entitlement.environment,
          expiresAt: entitlement.expiresAt.toISOString(),
          platform: entitlement.platform,
          productId: entitlement.productId,
          status: entitlement.status,
          willRenew: entitlement.willRenew,
        }
      : null,
    hasActiveSubscription,
    hasPremiumAccess,
    premiumAccessSource: hasActiveSubscription ? 'subscription' : trial.isActive ? 'trial' : 'none',
    premiumTrialDays: trial.trialDays,
    premiumTrialDaysRemaining: trial.daysRemaining,
    premiumTrialEndsAt: trial.endsAt?.toISOString() ?? null,
    premiumTrialStartedAt: trial.startedAt?.toISOString() ?? null,
  };
}

async function disableExpiredPremiumFeatures(userId: string) {
  await prisma.$transaction([
    prisma.user.updateMany({
      data: {
        preventPeerScreenshots: false,
        useGroupAliases: false,
      },
      where: {
        id: userId,
        OR: [
          { preventPeerScreenshots: true },
          { useGroupAliases: true },
        ],
      },
    }),
    prisma.conversationMember.updateMany({
      data: {
        aliasName: null,
        aliasPromptSeen: false,
      },
      where: {
        aliasName: { not: null },
        userId,
      },
    }),
    prisma.conversation.updateMany({
      data: { preventScreenshots: false },
      where: {
        ownerId: userId,
        preventScreenshots: true,
      },
    }),
  ]);
}

export async function requireActiveSubscription(req: Request, _res: Response, next: NextFunction) {
  try {
    const currentUser = getAuthedUser(req);

    if (!(await hasActiveSubscription(currentUser.id))) {
      throw new HttpError(402, 'An active MeetVap subscription is required');
    }

    next();
  } catch (error) {
    next(error);
  }
}

export async function hasActiveSubscription(userId: string) {
  if (config.SCREENSHOT_SUBSCRIPTION_BYPASS || await isSubscriptionBypassUser(userId)) {
    return true;
  }

  const entitlement = await getLatestEntitlement(userId);

  return !!entitlement && isEntitlementActive(entitlement);
}

export async function hasPremiumFeatureAccess(userId: string) {
  if (config.SCREENSHOT_SUBSCRIPTION_BYPASS || await isSubscriptionBypassUser(userId)) {
    return true;
  }

  const [entitlement, trial] = await Promise.all([
    getLatestEntitlement(userId),
    getPremiumTrialStatus(userId),
  ]);

  return (!!entitlement && isEntitlementActive(entitlement)) || trial.isActive;
}

export async function getPremiumFeatureAccessMap(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const accessByUserId = new Map<string, boolean>();

  uniqueUserIds.forEach((userId) => accessByUserId.set(userId, false));

  if (uniqueUserIds.length === 0) {
    return accessByUserId;
  }

  if (config.SCREENSHOT_SUBSCRIPTION_BYPASS) {
    uniqueUserIds.forEach((userId) => accessByUserId.set(userId, true));
    return accessByUserId;
  }

  const now = new Date();
  const trialDays = operationalConfig.premium.trialDays;
  const [users, entitlements] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        premiumTrialStartedAt: true,
        username: true,
      },
      where: { id: { in: uniqueUserIds } },
    }),
    prisma.subscriptionEntitlement.findMany({
      orderBy: { expiresAt: 'desc' },
      where: { userId: { in: uniqueUserIds } },
    }),
  ]);
  const bypassUsernames = new Set(
    config.SUBSCRIPTION_BYPASS_USERNAMES
      .split(',')
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean),
  );
  const latestEntitlementByUserId = new Map<string, typeof entitlements[number]>();

  entitlements.forEach((entitlement) => {
    if (!latestEntitlementByUserId.has(entitlement.userId)) {
      latestEntitlementByUserId.set(entitlement.userId, entitlement);
    }
  });

  users.forEach((user) => {
    const entitlement = latestEntitlementByUserId.get(user.id);
    const hasActiveEntitlement = !!entitlement && isEntitlementActive(entitlement);
    const hasActiveTrial = trialDays > 0 &&
      !!user.premiumTrialStartedAt &&
      user.premiumTrialStartedAt.getTime() + trialDays * DAY_MS > now.getTime();
    const isBypassUser = bypassUsernames.has(user.username.toLowerCase());

    accessByUserId.set(user.id, hasActiveEntitlement || hasActiveTrial || isBypassUser);
  });

  return accessByUserId;
}

export async function requirePremiumFeatureAccess(userId: string) {
  if (!(await hasPremiumFeatureAccess(userId))) {
    throw new HttpError(402, 'MeetVap premium access is required for this feature', {
      code: 'PREMIUM_REQUIRED',
    });
  }
}

async function getPremiumTrialStatus(userId: string) {
  const trialDays = operationalConfig.premium.trialDays;

  if (trialDays <= 0) {
    return {
      daysRemaining: 0,
      endsAt: null,
      isActive: false,
      startedAt: null,
      trialDays,
    };
  }

  const user = await prisma.user.findUnique({
    select: { premiumTrialStartedAt: true },
    where: { id: userId },
  });

  if (!user) {
    return {
      daysRemaining: 0,
      endsAt: null,
      isActive: false,
      startedAt: null,
      trialDays,
    };
  }

  const endsAt = new Date(user.premiumTrialStartedAt.getTime() + trialDays * DAY_MS);
  const remainingMs = endsAt.getTime() - Date.now();
  const isActive = remainingMs > 0;

  return {
    daysRemaining: isActive ? Math.max(1, Math.ceil(remainingMs / DAY_MS)) : 0,
    endsAt,
    isActive,
    startedAt: user.premiumTrialStartedAt,
    trialDays,
  };
}

export async function redeemSubscriptionCode(userId: string, rawCode: string) {
  const code = normalizeRedeemCode(rawCode);

  if (!code) {
    throw new HttpError(400, 'Redeem code is required', { code: 'REDEEM_CODE_REQUIRED' });
  }

  return prisma.$transaction(async (tx) => {
    const codeRows = await tx.$queryRaw<RedeemCodeRow[]>`
      select id, name, code, "productId", "durationMonths", "maxUses", "usedCount",
        "createdByAdminId", "createdByAdminUsername", "createdByPartnerId", "createdByPartnerUsername", "disabledAt"
      from "RedeemCode"
      where code = ${code}
      for update
    `;
    const redeemCode = codeRows[0];

    if (!redeemCode) {
      throw new HttpError(404, 'Redeem code is invalid', { code: 'REDEEM_CODE_INVALID' });
    }

    if (redeemCode.disabledAt) {
      throw new HttpError(400, 'Redeem code is disabled', { code: 'REDEEM_CODE_DISABLED' });
    }

    if (redeemCode.usedCount >= redeemCode.maxUses) {
      throw new HttpError(400, 'Redeem code has already been fully used', { code: 'REDEEM_CODE_USED_UP' });
    }

    const existingUse = await tx.$queryRaw<Array<{ id: string }>>`
      select id
      from "RedeemCodeUse"
      where "redeemCodeId" = ${redeemCode.id} and "userId" = ${userId}
      limit 1
    `;

    if (existingUse.length > 0) {
      throw new HttpError(400, 'You have already used this redeem code', { code: 'REDEEM_CODE_ALREADY_USED' });
    }

    const period = REDEEM_SUBSCRIPTION_PERIODS[redeemCode.durationMonths];

    if (!period) {
      throw new HttpError(500, 'Redeem code duration is not supported');
    }

    const baseRows = await tx.$queryRaw<Array<{ expiresAt: Date | null }>>`
      select max("expiresAt") as "expiresAt"
      from "SubscriptionEntitlement"
      where "userId" = ${userId}
        and status in ('ACTIVE','GRACE')
        and "expiresAt" > current_timestamp
    `;
    const now = new Date();
    const activeExpiry = baseRows[0]?.expiresAt ? new Date(baseRows[0].expiresAt) : null;
    const baseDate = activeExpiry && activeExpiry.getTime() > now.getTime() ? activeExpiry : now;
    const expiresAt = addCalendarMonths(baseDate, redeemCode.durationMonths);
    const redeemedAt = new Date();
    const rawLatestEvent = {
      code: redeemCode.code,
      durationMonths: redeemCode.durationMonths,
      redeemCodeId: redeemCode.id,
      redeemCodeName: redeemCode.name,
      redeemedAt: redeemedAt.toISOString(),
      sourceActorId: redeemCode.createdByAdminId ?? redeemCode.createdByPartnerId ?? null,
      sourceActorType: redeemCode.createdByPartnerId ? 'partner' : 'admin',
      sourceActorUsername: redeemCode.createdByAdminUsername ?? redeemCode.createdByPartnerUsername ?? null,
      source: 'redeem_code',
    };

    const entitlement = await tx.subscriptionEntitlement.create({
      data: {
        environment: 'PRODUCTION',
        expiresAt,
        lastVerifiedAt: redeemedAt,
        manualGrantedAt: redeemedAt,
        manualGrantedByAdminId: redeemCode.createdByAdminId ?? redeemCode.createdByPartnerId,
        manualGrantedByUsername: redeemCode.createdByAdminUsername ?? redeemCode.createdByPartnerUsername,
        platform: 'MANUAL',
        productId: redeemCode.productId || period.productId,
        rawLatestEvent,
        status: 'ACTIVE',
        userId,
        willRenew: false,
      },
    });

    await tx.$executeRaw`
      insert into "RedeemCodeUse" (id, "redeemCodeId", "userId", "entitlementId", "usedAt")
      values (${crypto.randomUUID()}, ${redeemCode.id}, ${userId}, ${entitlement.id}, ${redeemedAt})
    `;

    await tx.$executeRaw`
      update "RedeemCode"
      set "usedCount" = "usedCount" + 1,
        "updatedAt" = current_timestamp
      where id = ${redeemCode.id}
    `;

    return entitlement;
  });
}

export async function verifyAppleSubscription(userId: string, input: { productId: string; transactionReceipt: string }) {
  assertKnownProductId(input.productId);

  if (!config.APPLE_SHARED_SECRET) {
    throw new HttpError(500, 'Apple subscriptions are not configured');
  }

  const productionResponse = await verifyAppleReceipt(APPLE_PRODUCTION_VERIFY_URL, input.transactionReceipt);
  const response = productionResponse.status === 21007
    ? await verifyAppleReceipt(APPLE_SANDBOX_VERIFY_URL, input.transactionReceipt)
    : productionResponse;

  if (response.status !== 0) {
    throw new HttpError(400, `Apple receipt verification failed with status ${response.status}`);
  }

  if (config.APPLE_BUNDLE_ID && response.receipt?.bundle_id && response.receipt.bundle_id !== config.APPLE_BUNDLE_ID) {
    throw new HttpError(400, 'Apple receipt bundle id does not match this app');
  }

  const latestReceipt = findLatestAppleReceipt(response, input.productId);

  if (!latestReceipt?.expires_date_ms || !latestReceipt.original_transaction_id) {
    throw new HttpError(400, 'Apple receipt does not contain this subscription');
  }

  const expiresAt = new Date(Number(latestReceipt.expires_date_ms));
  const renewalInfo = response.pending_renewal_info?.find((item) => (
    item.original_transaction_id === latestReceipt.original_transaction_id &&
    item.product_id === latestReceipt.product_id
  ));
  const status = latestReceipt.cancellation_date_ms
    ? 'REFUNDED'
    : expiresAt.getTime() > Date.now()
      ? 'ACTIVE'
      : 'EXPIRED';

  return prisma.subscriptionEntitlement.upsert({
    create: {
      environment: response.environment === 'Sandbox' ? 'SANDBOX' : 'PRODUCTION',
      expiresAt,
      lastVerifiedAt: new Date(),
      originalTransactionId: latestReceipt.original_transaction_id,
      platform: 'IOS',
      productId: latestReceipt.product_id ?? input.productId,
      rawLatestEvent: response as object,
      status,
      transactionId: latestReceipt.transaction_id,
      userId,
      willRenew: renewalInfo?.auto_renew_status !== '0',
    },
    update: {
      environment: response.environment === 'Sandbox' ? 'SANDBOX' : 'PRODUCTION',
      expiresAt,
      lastVerifiedAt: new Date(),
      productId: latestReceipt.product_id ?? input.productId,
      rawLatestEvent: response as object,
      status,
      transactionId: latestReceipt.transaction_id,
      userId,
      willRenew: renewalInfo?.auto_renew_status !== '0',
    },
    where: {
      platform_originalTransactionId: {
        originalTransactionId: latestReceipt.original_transaction_id,
        platform: 'IOS',
      },
    },
  });
}

export async function verifyGoogleSubscription(userId: string, input: { productId: string; purchaseToken: string }) {
  assertKnownProductId(input.productId);

  if (!config.GOOGLE_PACKAGE_NAME) {
    throw new HttpError(500, 'Google Play subscriptions are not configured');
  }

  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config.GOOGLE_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new HttpError(400, `Google Play subscription verification failed with ${response.status}`);
  }

  const purchase = await response.json() as GoogleSubscriptionV2;
  const lineItem = purchase.lineItems?.find((item) => item.productId === input.productId) ?? purchase.lineItems?.[0];
  const expiresAt = lineItem?.expiryTime ? new Date(lineItem.expiryTime) : null;

  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new HttpError(400, 'Google Play response does not include a valid expiry');
  }

  const status = mapGoogleSubscriptionStatus(purchase.subscriptionState, expiresAt);

  return prisma.subscriptionEntitlement.upsert({
    create: {
      environment: 'PRODUCTION',
      expiresAt,
      lastVerifiedAt: new Date(),
      platform: 'ANDROID',
      productId: lineItem?.productId ?? input.productId,
      purchaseToken: input.purchaseToken,
      rawLatestEvent: purchase as object,
      status,
      userId,
      willRenew: purchase.subscriptionState !== 'SUBSCRIPTION_STATE_CANCELED',
    },
    update: {
      expiresAt,
      lastVerifiedAt: new Date(),
      productId: lineItem?.productId ?? input.productId,
      rawLatestEvent: purchase as object,
      status,
      userId,
      willRenew: purchase.subscriptionState !== 'SUBSCRIPTION_STATE_CANCELED',
    },
    where: {
      platform_purchaseToken: {
        platform: 'ANDROID',
        purchaseToken: input.purchaseToken,
      },
    },
  });
}

export async function refreshGoogleSubscriptionByToken(purchaseToken: string) {
  const existing = await prisma.subscriptionEntitlement.findFirst({
    where: {
      platform: 'ANDROID',
      purchaseToken,
    },
  });

  if (!existing) {
    return null;
  }

  return verifyGoogleSubscription(existing.userId, {
    productId: existing.productId,
    purchaseToken,
  });
}

export async function updateAppleSubscriptionFromServerNotification(input: {
  originalTransactionId?: string;
  productId?: string;
  revocationDate?: number;
  transactionId?: string;
  expiresDate?: number;
}) {
  if (!input.originalTransactionId) {
    return null;
  }

  const existing = await prisma.subscriptionEntitlement.findFirst({
    where: {
      originalTransactionId: input.originalTransactionId,
      platform: 'IOS',
    },
  });

  if (!existing) {
    return null;
  }

  const expiresAt = input.expiresDate ? new Date(input.expiresDate) : existing.expiresAt;
  const status = input.revocationDate
    ? 'REFUNDED'
    : expiresAt.getTime() > Date.now()
      ? 'ACTIVE'
      : 'EXPIRED';

  return prisma.subscriptionEntitlement.update({
    data: {
      expiresAt,
      lastVerifiedAt: new Date(),
      productId: input.productId ?? existing.productId,
      rawLatestEvent: input,
      status,
      transactionId: input.transactionId ?? existing.transactionId,
      willRenew: status === 'ACTIVE',
    },
    where: { id: existing.id },
  });
}

async function getLatestEntitlement(userId: string) {
  return prisma.subscriptionEntitlement.findFirst({
    orderBy: { expiresAt: 'desc' },
    where: { userId },
  });
}

function isEntitlementActive(entitlement: { expiresAt: Date; status: string }) {
  return entitlement.expiresAt.getTime() > Date.now() && ACTIVE_STATUSES.includes(entitlement.status as 'ACTIVE' | 'GRACE');
}

function normalizeRedeemCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function addCalendarMonths(dateValue: Date, months: number) {
  const result = new Date(dateValue);
  const originalDay = result.getDate();

  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(Math.min(originalDay, daysInMonth(result.getFullYear(), result.getMonth())));

  return result;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function createBypassSubscriptionStatus(): SubscriptionStatusResponse {
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  return {
    entitlement: {
      environment: 'SANDBOX',
      expiresAt: expiresAt.toISOString(),
      platform: 'ANDROID',
      productId: 'meetvap_screenshot_bypass',
      status: 'ACTIVE',
      willRenew: false,
    },
    hasActiveSubscription: true,
    hasPremiumAccess: true,
    premiumAccessSource: 'subscription',
    premiumTrialDays: operationalConfig.premium.trialDays,
    premiumTrialDaysRemaining: 0,
    premiumTrialEndsAt: null,
    premiumTrialStartedAt: null,
  };
}

async function isSubscriptionBypassUser(userId: string) {
  const usernames = new Set(
    config.SUBSCRIPTION_BYPASS_USERNAMES
      .split(',')
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean),
  );

  if (!usernames.size) {
    return false;
  }

  const user = await prisma.user.findUnique({
    select: { username: true },
    where: { id: userId },
  });

  return !!user && usernames.has(user.username.toLowerCase());
}

function assertKnownProductId(productId: string) {
  if (!SUBSCRIPTION_PRODUCT_IDS.includes(productId as typeof SUBSCRIPTION_PRODUCT_IDS[number])) {
    throw new HttpError(400, 'Unknown subscription product');
  }
}

async function verifyAppleReceipt(url: string, receiptData: string) {
  const response = await fetch(url, {
    body: JSON.stringify({
      'exclude-old-transactions': false,
      password: config.APPLE_SHARED_SECRET,
      'receipt-data': receiptData,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError(400, `Apple receipt verification failed with ${response.status}`);
  }

  return response.json() as Promise<AppleReceiptResponse>;
}

function findLatestAppleReceipt(response: AppleReceiptResponse, productId: string) {
  const receipts = [
    ...(response.latest_receipt_info ?? []),
    ...(response.receipt?.in_app ?? []),
  ];

  return receipts
    .filter((receipt) => receipt.product_id === productId)
    .sort((a, b) => Number(b.expires_date_ms ?? 0) - Number(a.expires_date_ms ?? 0))[0];
}

async function getGoogleAccessToken() {
  const serviceAccount = await readGoogleServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(JSON.stringify({
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
    iss: serviceAccount.client_email,
    scope: GOOGLE_SCOPE,
  }));
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

function base64UrlEncode(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function mapGoogleSubscriptionStatus(subscriptionState: string | undefined, expiresAt: Date) {
  if (expiresAt.getTime() <= Date.now()) {
    return 'EXPIRED';
  }

  switch (subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'ACTIVE';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'GRACE';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'BILLING_RETRY';
    case 'SUBSCRIPTION_STATE_CANCELED':
      return 'CANCELLED';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'EXPIRED';
    default:
      return 'ACTIVE';
  }
}
