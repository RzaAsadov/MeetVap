import { Platform } from 'react-native';

import { t } from '../i18n';

export const SUBSCRIPTION_PRODUCT_IDS = [
  'meetvap_monthly',
  'meetvap_3_month',
  'meetvap_6_month',
  'meetvap_yearly',
] as const;

export type SubscriptionProductId = typeof SUBSCRIPTION_PRODUCT_IDS[number];

export type StoreSubscriptionProduct = {
  description?: string;
  id: SubscriptionProductId;
  localizedPrice?: string;
  offerToken?: string;
  periodLabel: string;
  priceLabel: string;
  title: string;
};

type IapModule = {
  clearProductsIOS?: () => Promise<void>;
  clearTransactionIOS?: () => Promise<void>;
  endConnection?: () => Promise<void>;
  finishTransaction?: (input: { isConsumable?: boolean; purchase: StorePurchase }) => Promise<void>;
  getAvailablePurchases?: () => Promise<StorePurchase[]>;
  getStorefront?: () => Promise<string>;
  getSubscriptions: (input: { skus: string[] } | string[]) => Promise<StoreProduct[]>;
  initConnection: () => Promise<boolean>;
  requestSubscription: (input: { sku: string; andDangerouslyFinishTransactionAutomaticallyIOS?: boolean } | { subscriptionOffers: Array<{ offerToken: string; sku: string }> } | string) => Promise<StorePurchase | StorePurchase[] | void>;
  setup?: (input?: { storekitMode?: 'STOREKIT1_MODE' | 'STOREKIT2_MODE' | 'STOREKIT_HYBRID_MODE' }) => void;
};

type StoreProduct = {
  description?: string;
  id?: string | number;
  localizedPrice?: string;
  price?: string;
  productId?: string;
  productID?: string;
  subscriptionOfferDetails?: Array<{
    offerToken?: string;
    pricingPhases?: {
      pricingPhaseList?: Array<{
        billingPeriod?: string;
        formattedPrice?: string;
      }>;
    };
  }>;
  title?: string;
};

export type StorePurchase = {
  productId?: string;
  purchaseToken?: string;
  transactionId?: string;
  transactionReceipt?: string;
};

const PRODUCT_LABELS: Record<SubscriptionProductId, { periodLabel: string; title: string }> = {
  meetvap_3_month: { periodLabel: 'Every 3 months', title: '3 months' },
  meetvap_6_month: { periodLabel: 'Every 6 months', title: '6 months' },
  meetvap_monthly: { periodLabel: 'Monthly', title: 'Monthly' },
  meetvap_yearly: { periodLabel: 'Yearly', title: '1 year' },
};

export async function loadStoreSubscriptions() {
  const iap = getIapModule();
  configureIap(iap);
  const canMakePayments = await iap.initConnection();

  if (Platform.OS === 'ios' && canMakePayments === false) {
    throw new Error(t('appleSubscriptionsUnavailable'));
  }

  if (Platform.OS === 'ios') {
    await iap.clearTransactionIOS?.().catch(() => undefined);
  }

  const products = await getStoreProducts(iap);
  const mappedProducts = products
    .map(mapStoreProduct)
    .filter((product): product is StoreSubscriptionProduct => !!product);

  if (Platform.OS === 'ios' && mappedProducts.length === 0) {
    const returnedIds = products
      .map((product) => getStoreProductId(product) ?? '(missing-id)')
      .join(', ');

    throw new Error(
      `Apple returned subscription products, but none matched the expected IDs. ` +
      `Expected: ${SUBSCRIPTION_PRODUCT_IDS.join(', ')}. ` +
      `Returned: ${returnedIds || '(none)'}. ` +
      `This usually means the App Store product catalog still does not match the app bundle/store environment.`,
    );
  }

  const productById = new Map(mappedProducts.map((product) => [product.id, product]));

  return SUBSCRIPTION_PRODUCT_IDS.map((id) => productById.get(id) ?? {
    id,
    localizedPrice: undefined,
    periodLabel: PRODUCT_LABELS[id].periodLabel,
    priceLabel: 'Loading price',
    title: PRODUCT_LABELS[id].title,
  });
}

export async function requestStoreSubscription(productId: SubscriptionProductId) {
  const iap = getIapModule();
  configureIap(iap);
  const products = await loadStoreSubscriptions();
  const selectedProduct = products.find((product) => product.id === productId);
  const result = await iap.requestSubscription(
    Platform.OS === 'android'
      ? {
          subscriptionOffers: [{
            offerToken: selectedProduct?.offerToken ?? '',
            sku: productId,
          }],
        }
      : {
          andDangerouslyFinishTransactionAutomaticallyIOS: false,
          sku: productId,
        },
  );
  const purchase = Array.isArray(result) ? result[0] : result;

  if (!purchase) {
    throw new Error(t('purchaseCancelled'));
  }

  return purchase;
}

export async function restoreStorePurchases() {
  const iap = getIapModule();
  configureIap(iap);
  await iap.initConnection();

  return iap.getAvailablePurchases?.() ?? [];
}

export async function finishStorePurchase(purchase: StorePurchase) {
  const iap = getIapModule();

  await iap.finishTransaction?.({ isConsumable: false, purchase });
}

export async function closeStoreSubscriptions() {
  await getIapModule().endConnection?.();
}

function getIapModule() {
  try {
    // Kept dynamic so typecheck still works before native pods/Gradle are rebuilt.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-iap') as IapModule;
  } catch {
    throw new Error(t('inAppPurchasesNotInstalled'));
  }
}

function configureIap(iap: IapModule) {
  if (Platform.OS === 'ios') {
    // The backend currently verifies classic App Store receipts, so force the
    // stable StoreKit 1 purchase path instead of newer StoreKit 2 behavior.
    iap.setup?.({ storekitMode: 'STOREKIT1_MODE' });
  }
}

async function getStoreProducts(iap: IapModule) {
  const skus = [...SUBSCRIPTION_PRODUCT_IDS];
  let lastError: unknown;
  let storefront: string | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (Platform.OS === 'ios' && attempt > 0) {
        await iap.clearProductsIOS?.().catch(() => undefined);
      }

      if (Platform.OS === 'ios' && !storefront) {
        storefront = await iap.getStorefront?.().catch(() => undefined);
      }

      const products = await iap.getSubscriptions({ skus });
      const normalizedIds = products.map(getStoreProductId).filter((id): id is string => !!id);

      if (normalizedIds.length > 0) {
        return products;
      }
    } catch (error) {
      lastError = new Error(
        `Apple subscription fetch attempt ${attempt + 1} failed. ${describeUnknownError(error)}`,
      );
    }

    if (attempt < 2) {
      await delay(900);
    }
  }

  if (lastError) {
    throw lastError;
  }

  if (Platform.OS === 'ios') {
    const storefrontSuffix = storefront ? ` Storefront: ${storefront}.` : '';

    throw new Error(
      `Apple returned zero subscription products for ${skus.join(', ')}.${storefrontSuffix} ` +
      'Check App Store Connect subscription availability, pricing/localization propagation, Paid Apps agreement, banking/tax status, and the device Apple account storefront.',
    );
  }

  return [];
}

function mapStoreProduct(product: StoreProduct): StoreSubscriptionProduct | null {
  const id = getStoreProductId(product) as SubscriptionProductId | undefined;

  if (!id || !SUBSCRIPTION_PRODUCT_IDS.includes(id)) {
    return null;
  }

  const firstOfferPrice = product.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList?.[0]?.formattedPrice;

  return {
    description: product.description,
    id,
    localizedPrice: product.localizedPrice ?? firstOfferPrice,
    offerToken: product.subscriptionOfferDetails?.[0]?.offerToken,
    periodLabel: PRODUCT_LABELS[id].periodLabel,
    priceLabel: product.localizedPrice ?? firstOfferPrice ?? product.price ?? '',
    title: PRODUCT_LABELS[id].title,
  };
}

function getStoreProductId(product: StoreProduct) {
  const rawId = product.productId ?? product.productID ?? product.id;

  return typeof rawId === 'number'
    ? String(rawId)
    : rawId;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown Error instance';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = 'message' in error && typeof error.message === 'string' ? error.message.trim() : '';
    const debugMessage = 'debugMessage' in error && typeof error.debugMessage === 'string' ? error.debugMessage.trim() : '';
    const code = 'code' in error && typeof error.code === 'string' ? error.code.trim() : '';
    const responseCode = 'responseCode' in error ? String(error.responseCode) : '';
    const json = safeStringify(error);

    return [
      message,
      debugMessage,
      code ? `code=${code}` : '',
      responseCode ? `responseCode=${responseCode}` : '',
      json ? `payload=${json}` : '',
    ].filter(Boolean).join(' | ') || 'Unknown object error';
  }

  return `Unknown error type: ${String(error)}`;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
