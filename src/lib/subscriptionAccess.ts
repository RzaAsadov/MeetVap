import { SubscriptionStatus } from '../types/domain';

const BYPASS_SUBSCRIPTION = process.env.EXPO_PUBLIC_BYPASS_SUBSCRIPTION === 'true';

export function isSubscriptionBypassed() {
  return BYPASS_SUBSCRIPTION;
}

export function hasUsableSubscription(subscriptionStatus: SubscriptionStatus | null) {
  if (BYPASS_SUBSCRIPTION) {
    return true;
  }

  return !!subscriptionStatus?.hasActiveSubscription &&
    !!subscriptionStatus.entitlement &&
    new Date(subscriptionStatus.entitlement.expiresAt).getTime() > Date.now();
}

export function hasPremiumAccess(subscriptionStatus: SubscriptionStatus | null) {
  if (BYPASS_SUBSCRIPTION) {
    return true;
  }

  if (hasUsableSubscription(subscriptionStatus)) {
    return true;
  }

  if (subscriptionStatus?.premiumAccessSource === 'trial') {
    return !!subscriptionStatus.premiumTrialEndsAt &&
      new Date(subscriptionStatus.premiumTrialEndsAt).getTime() > Date.now();
  }

  if (subscriptionStatus?.premiumAccessSource === 'subscription') {
    return hasUsableSubscription(subscriptionStatus);
  }

  if (subscriptionStatus?.premiumAccessSource === 'none') {
    return false;
  }

  return subscriptionStatus?.hasPremiumAccess === true;
}

export function createEmptySubscriptionStatus(): SubscriptionStatus {
  return {
    entitlement: null,
    hasActiveSubscription: false,
    hasPremiumAccess: false,
    premiumAccessSource: 'none',
    premiumTrialDays: 0,
    premiumTrialDaysRemaining: 0,
    premiumTrialEndsAt: null,
    premiumTrialStartedAt: null,
  };
}

export function createBypassSubscriptionStatus(): SubscriptionStatus {
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
    premiumTrialDays: 0,
    premiumTrialDaysRemaining: 0,
    premiumTrialEndsAt: null,
    premiumTrialStartedAt: null,
  };
}
