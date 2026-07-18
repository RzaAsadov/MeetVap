import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDeviceLanguage, getLanguagePreferenceFlag, getLanguagePreferenceLabel, LANGUAGE_PREFERENCES, t } from '../i18n';
import { redeemSubscriptionCode, verifyAppleSubscription, verifyGoogleSubscription } from '../lib/backend';
import { closeStoreSubscriptions, finishStorePurchase, loadStoreSubscriptions, requestStoreSubscription, restoreStorePurchases, StorePurchase, StoreSubscriptionProduct, SUBSCRIPTION_PRODUCT_IDS, SubscriptionProductId } from '../lib/subscriptions';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';
import { SubscriptionStatus } from '../types/domain';

const PLAN_ACCENTS: Record<SubscriptionProductId, string> = {
  meetvap_3_month: '#4f7cff',
  meetvap_6_month: '#8b5cf6',
  meetvap_monthly: '#128c7e',
  meetvap_yearly: '#f59e0b',
};

const PLAN_BADGE_KEYS: Partial<Record<SubscriptionProductId, string>> = {
  meetvap_6_month: 'subscriptionPlanBalanced',
  meetvap_yearly: 'subscriptionPlanBestValue',
};

export function SubscriptionScreen() {
  useThemeColors();
  styles = createStyles();
  const insets = useSafeAreaInsets();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const languagePreference = useAppStore((state) => state.languagePreference);
  const setLanguagePreference = useAppStore((state) => state.setLanguagePreference);
  const setSubscriptionStatus = useAppStore((state) => state.setSubscriptionStatus);
  const refreshSubscriptionStatus = useAppStore((state) => state.refreshSubscriptionStatus);
  const signOut = useAppStore((state) => state.signOut);
  const [products, setProducts] = useState<StoreSubscriptionProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<SubscriptionProductId>('meetvap_yearly');
  const [isLoadingProducts, setLoadingProducts] = useState(true);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'buy' | 'redeem' | 'restore' | 'refresh' | null>(null);
  const [isLanguageModalVisible, setLanguageModalVisible] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemModalVisible, setRedeemModalVisible] = useState(false);
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId),
    [products, selectedProductId],
  );

  useEffect(() => {
    let isMounted = true;

    loadStoreSubscriptions()
      .then((items) => {
        if (isMounted) {
          setLoadErrorMessage(null);
          setProducts(items);
        }
      })
      .catch((error) => {
        const message = getErrorMessage(error);

        if (isMounted) {
          setLoadErrorMessage(message);
        }

        Alert.alert(t('subscriptionStoreUnavailable'), message);
      })
      .finally(() => {
        if (isMounted) {
          setLoadingProducts(false);
        }
      });

    return () => {
      isMounted = false;
      void closeStoreSubscriptions();
    };
  }, []);

  const verifyPurchase = useCallback(async (purchase: StorePurchase, fallbackProductId?: SubscriptionProductId) => {
    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const productId = normalizeProductId(purchase.productId ?? fallbackProductId);

    if (!productId) {
      throw new Error(t('subscriptionStoreUnknownProduct'));
    }

    let status: SubscriptionStatus;

    if (Platform.OS === 'ios') {
      if (!purchase.transactionReceipt) {
        throw new Error(t('subscriptionAppleReceiptMissing'));
      }
      status = await verifyAppleSubscription(serverUrl, { productId, transactionReceipt: purchase.transactionReceipt });
    } else {
      if (!purchase.purchaseToken) {
        throw new Error(t('subscriptionGoogleTokenMissing'));
      }
      status = await verifyGoogleSubscription(serverUrl, { productId, purchaseToken: purchase.purchaseToken });
    }

    await setSubscriptionStatus(status);
    await finishStorePurchase(purchase);

    if (!status.hasActiveSubscription) {
      throw new Error(t('subscriptionVerifiedInactive'));
    }
  }, [serverUrl, setSubscriptionStatus]);

  async function handleSubscribe() {
    if (!selectedProductId) {
      return;
    }

    setBusyAction('buy');

    try {
      const purchase = await requestStoreSubscription(selectedProductId);
      await verifyPurchase(purchase, selectedProductId);
    } catch (error) {
      Alert.alert(t('subscriptionSubscribeFailed'), getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestore() {
    setBusyAction('restore');

    try {
      const purchases = await restoreStorePurchases();
      const subscriptionPurchase = purchases.find((purchase) => normalizeProductId(purchase.productId));

      if (!subscriptionPurchase) {
        Alert.alert(t('subscriptionNoFoundTitle'), t('subscriptionNoActiveFound'));
        return;
      }

      await verifyPurchase(subscriptionPurchase);
    } catch (error) {
      Alert.alert(t('subscriptionRestoreFailed'), getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefreshStatus() {
    setBusyAction('refresh');

    try {
      await refreshSubscriptionStatus();
    } catch (error) {
      Alert.alert(t('subscriptionRefreshFailed'), getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRedeemCode() {
    const code = redeemCode.trim();

    if (!code) {
      Alert.alert(t('subscriptionRedeemFailed'), t('subscriptionRedeemEmptyCode'));
      return;
    }

    if (!serverUrl) {
      Alert.alert(t('subscriptionRedeemFailed'), t('serverUrlNotConfigured'));
      return;
    }

    setBusyAction('redeem');

    try {
      const status = await redeemSubscriptionCode(serverUrl, { code });
      await setSubscriptionStatus(status);

      if (!status.hasActiveSubscription) {
        throw new Error(t('subscriptionVerifiedInactive'));
      }

      setRedeemModalVisible(false);
      setRedeemCode('');
      Alert.alert(t('subscriptionRedeemSuccessTitle'), t('subscriptionRedeemSuccessMessage'));
    } catch (error) {
      Alert.alert(t('subscriptionRedeemFailed'), getErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  const isBusy = busyAction !== null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 28, 40), paddingTop: Math.max(insets.top + 20, 36) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>MeetVap</Text>
            <Pressable accessibilityLabel={t('language')} onPress={() => setLanguageModalVisible(true)} style={styles.languageButton}>
              <Ionicons color={colors.primary} name="language-outline" size={22} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>{t('subscriptionScreenSubtitle')}</Text>
        </View>

        <View style={styles.benefits}>
          <Benefit icon="shield-checkmark-outline" label={t('subscriptionBenefitScreenshots')} />
          <Benefit icon="keypad-outline" label={t('subscriptionBenefitPanicPin')} />
          <Benefit icon="id-card-outline" label={t('subscriptionBenefitGroupNames')} />
          <Benefit icon="mic-outline" label={t('subscriptionBenefitVoiceChanger')} />
        </View>

        <View style={styles.plansHeader}>
          <Text style={styles.sectionTitle}>{t('subscriptionChoosePlan')}</Text>
          {isLoadingProducts ? <ActivityIndicator color={colors.primary} /> : null}
        </View>

        <View style={styles.plans}>
          {(products.length > 0 ? products : getFallbackProducts()).map((product) => (
            <PlanRow
              key={product.id}
              product={getLocalizedProduct(product)}
              selected={product.id === selectedProductId}
              onPress={() => setSelectedProductId(product.id)}
            />
          ))}
        </View>

        <Pressable
          disabled={isBusy || isLoadingProducts}
          onPress={handleSubscribe}
          style={({ pressed }) => [
            styles.subscribeButton,
            (pressed || isBusy) && styles.subscribeButtonPressed,
            (isBusy || isLoadingProducts) && styles.disabledButton,
          ]}
        >
          {busyAction === 'buy' ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Text style={styles.subscribeButtonText}>
                {selectedProduct?.priceLabel ? t('subscriptionContinuePrice', { price: selectedProduct.priceLabel }) : t('continue')}
              </Text>
              <Ionicons color={colors.white} name="arrow-forward" size={22} />
            </>
          )}
        </Pressable>

        <Pressable
          disabled={isBusy}
          onPress={() => setRedeemModalVisible(true)}
          style={({ pressed }) => [
            styles.redeemBadgeButton,
            pressed && styles.redeemBadgeButtonPressed,
            isBusy && styles.disabledButton,
          ]}
        >
          <Text style={styles.redeemBadgeText}>{t('subscriptionRedeemCode')}</Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable disabled={isBusy} onPress={handleRestore} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>{busyAction === 'restore' ? t('subscriptionRestoring') : t('subscriptionRestorePurchase')}</Text>
          </Pressable>
          <Pressable disabled={isBusy} onPress={handleRefreshStatus} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>{busyAction === 'refresh' ? t('checking') : t('subscriptionRefreshStatus')}</Text>
          </Pressable>
          <Pressable disabled={isBusy} onPress={signOut} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>{t('subscriptionSignOut')}</Text>
          </Pressable>
        </View>

        <Text style={styles.terms}>
          {Platform.OS === 'ios' ? t('subscriptionBillingTermsApple') : t('subscriptionBillingTermsGoogle')}
        </Text>
        <View style={styles.links}>
          <Pressable onPress={() => openUrl(`https://meetvap.com/terms?lang=${getDeviceLanguage()}`)}>
            <Text style={styles.linkText}>{t('subscriptionTermsOfUseEula')}</Text>
          </Pressable>
          <Text style={styles.linkDivider}>/</Text>
          <Pressable onPress={() => openUrl('https://meetvap.com/privacy')}>
            <Text style={styles.linkText}>{t('privacy')}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (busyAction !== 'redeem') {
            setRedeemModalVisible(false);
          }
        }}
        transparent
        visible={redeemModalVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
          style={styles.modalRoot}
        >
          <Pressable
            disabled={busyAction === 'redeem'}
            onPress={() => setRedeemModalVisible(false)}
            style={StyleSheet.absoluteFillObject}
          />
          <ScrollView
            contentContainerStyle={styles.redeemModalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.redeemModalScroll}
          >
            <View style={styles.redeemCard}>
              <View style={styles.redeemHeader}>
                <Text style={styles.redeemTitle}>{t('subscriptionRedeemTitle')}</Text>
                <Pressable
                  disabled={busyAction === 'redeem'}
                  onPress={() => setRedeemModalVisible(false)}
                  style={styles.redeemCloseButton}
                >
                  <Ionicons color={colors.textPrimary} name="close" size={22} />
                </Pressable>
              </View>
              <Text style={styles.redeemDescription}>{t('subscriptionRedeemDescription')}</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                editable={busyAction !== 'redeem'}
                onChangeText={setRedeemCode}
                onSubmitEditing={handleRedeemCode}
                placeholder={t('subscriptionRedeemPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                returnKeyType="done"
                style={styles.redeemInput}
                value={redeemCode}
              />
              <Pressable
                disabled={busyAction === 'redeem'}
                onPress={handleRedeemCode}
                style={({ pressed }) => [
                  styles.redeemSubmitButton,
                  (pressed || busyAction === 'redeem') && styles.subscribeButtonPressed,
                ]}
              >
                {busyAction === 'redeem' ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.redeemSubmitButtonText}>{t('subscriptionUseCode')}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="fade" transparent visible={isLanguageModalVisible} onRequestClose={() => setLanguageModalVisible(false)}>
        <Pressable onPress={() => setLanguageModalVisible(false)} style={styles.languageModalBackdrop}>
          <Pressable style={styles.languageModal}>
            <Text style={styles.languageModalTitle}>{t('language')}</Text>
            {LANGUAGE_PREFERENCES.map((preference) => (
              <Pressable
                key={preference}
                onPress={() => {
                  void setLanguagePreference(preference);
                  setLanguageModalVisible(false);
                }}
                style={styles.languageOption}
              >
                <View style={styles.languageOptionLabel}>
                  <Text style={styles.languageOptionFlag}>{getLanguagePreferenceFlag(preference)}</Text>
                  <Text style={styles.languageOptionText}>{getLanguagePreferenceLabel(preference)}</Text>
                </View>
                {languagePreference === preference ? <Ionicons color={colors.primary} name="checkmark" size={22} /> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Benefit({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons color={colors.primary} name={icon} size={20} />
      <Text style={styles.benefitText}>{label}</Text>
    </View>
  );
}

function PlanRow({ onPress, product, selected }: { onPress: () => void; product: StoreSubscriptionProduct; selected: boolean }) {
  const badgeKey = PLAN_BADGE_KEYS[product.id];
  const badge = badgeKey ? t(badgeKey) : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.plan,
        selected && styles.planSelected,
        pressed && styles.planPressed,
      ]}
    >
      <View style={[styles.planAccent, { backgroundColor: PLAN_ACCENTS[product.id] }]} />
      <View style={styles.planBody}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planTitle}>{product.title}</Text>
          {badge ? <Text style={styles.planBadge}>{badge}</Text> : null}
        </View>
        <Text style={styles.planPeriod}>{product.periodLabel}</Text>
      </View>
      <View style={styles.planPriceWrap}>
        <Text style={styles.planPrice}>{product.priceLabel || product.localizedPrice || t('subscriptionPriceUnavailable')}</Text>
        <Ionicons color={selected ? colors.primary : colors.textSecondary} name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} />
      </View>
    </Pressable>
  );
}

function getFallbackProducts() {
  return SUBSCRIPTION_PRODUCT_IDS.map((id) => ({
    id,
    localizedPrice: undefined,
    periodLabel: getPlanPeriodLabel(id),
    priceLabel: t('subscriptionLoadingPrice'),
    title: getPlanTitle(id),
  }));
}

function getLocalizedProduct(product: StoreSubscriptionProduct) {
  return {
    ...product,
    periodLabel: getPlanPeriodLabel(product.id),
    title: getPlanTitle(product.id),
  };
}

function getPlanTitle(productId: SubscriptionProductId) {
  switch (productId) {
    case 'meetvap_3_month':
      return t('subscriptionPlan3Month');
    case 'meetvap_6_month':
      return t('subscriptionPlan6Month');
    case 'meetvap_yearly':
      return t('subscriptionPlanYearly');
    case 'meetvap_monthly':
    default:
      return t('subscriptionPlanMonthly');
  }
}

function getPlanPeriodLabel(productId: SubscriptionProductId) {
  switch (productId) {
    case 'meetvap_3_month':
      return t('subscriptionPeriod3Month');
    case 'meetvap_6_month':
      return t('subscriptionPeriod6Month');
    case 'meetvap_yearly':
      return t('subscriptionPeriodYearly');
    case 'meetvap_monthly':
    default:
      return t('subscriptionPeriodMonthly');
  }
}

function normalizeProductId(productId?: string): SubscriptionProductId | null {
  return SUBSCRIPTION_PRODUCT_IDS.includes(productId as SubscriptionProductId)
    ? productId as SubscriptionProductId
    : null;
}

function openUrl(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = 'message' in error && typeof error.message === 'string' ? error.message.trim() : '';
    const maybeDebugMessage = 'debugMessage' in error && typeof error.debugMessage === 'string' ? error.debugMessage.trim() : '';
    const maybeCode = 'code' in error && typeof error.code === 'string' ? error.code.trim() : '';

    if (maybeMessage) {
      return maybeCode ? `${maybeMessage} (${maybeCode})` : maybeMessage;
    }

    if (maybeDebugMessage) {
      return maybeCode ? `${maybeDebugMessage} (${maybeCode})` : maybeDebugMessage;
    }

    if (maybeCode) {
      return maybeCode;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return `Unknown subscription error: ${describeOpaqueError(error)}`;
}

function describeOpaqueError(error: unknown) {
  if (error === null) {
    return 'null';
  }

  if (error === undefined) {
    return 'undefined';
  }

  if (typeof error === 'object') {
    try {
      const json = JSON.stringify(error);

      return json || '[object with no serializable fields]';
    } catch {
      return '[unserializable object]';
    }
  }

  return String(error);
}

function createStyles() {
  return StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      justifyContent: 'center',
      marginTop: spacing.md,
    },
    benefit: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      flexBasis: '48%',
      flexDirection: 'row',
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
    },
    benefits: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.xl,
    },
    benefitText: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 17,
    },
    content: {
      paddingHorizontal: spacing.lg,
    },
    disabledButton: {
      opacity: 0.65,
    },
    hero: {
      alignItems: 'center',
    },
    linkDivider: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    links: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.xs,
      justifyContent: 'center',
      marginTop: spacing.md,
    },
    linkText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '800',
    },
    languageButton: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    languageModal: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      maxWidth: 420,
      padding: spacing.lg,
      width: '86%',
    },
    languageModalBackdrop: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      flex: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    languageModalTitle: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '900',
      marginBottom: spacing.sm,
    },
    languageOption: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 50,
      paddingVertical: spacing.sm,
    },
    languageOptionFlag: {
      fontSize: 20,
    },
    languageOptionLabel: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    languageOptionText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
    modalRoot: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      flex: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    plan: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      minHeight: 78,
      overflow: 'hidden',
    },
    planAccent: {
      alignSelf: 'stretch',
      width: 5,
    },
    planBadge: {
      backgroundColor: '#fff3d7',
      borderRadius: 6,
      color: '#8a5a00',
      fontSize: 11,
      fontWeight: '900',
      overflow: 'hidden',
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    planBody: {
      flex: 1,
      gap: 4,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    planPeriod: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    planPressed: {
      opacity: 0.82,
    },
    planPrice: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '900',
      textAlign: 'right',
    },
    planPriceWrap: {
      alignItems: 'flex-end',
      gap: spacing.xs,
      paddingRight: spacing.md,
    },
    plans: {
      gap: spacing.sm,
    },
    plansHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
      marginTop: spacing.xl,
    },
    planSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    planTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '900',
    },
    planTitleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    redeemCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      gap: spacing.md,
      maxWidth: 420,
      padding: spacing.lg,
      width: '100%',
    },
    redeemCloseButton: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      borderRadius: 18,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    redeemDescription: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
    },
    redeemHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'space-between',
    },
    redeemBadgeButton: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: colors.outgoingBubble,
      borderColor: colors.primary,
      borderRadius: 999,
      borderWidth: 1,
      justifyContent: 'center',
      marginTop: spacing.md,
      minHeight: 42,
      paddingHorizontal: spacing.lg,
    },
    redeemBadgeButtonPressed: {
      opacity: 0.78,
    },
    redeemBadgeText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '900',
    },
    redeemInput: {
      backgroundColor: colors.appBackground,
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
      minHeight: 52,
      paddingHorizontal: spacing.md,
    },
    redeemModalScroll: {
      alignSelf: 'stretch',
      flex: 1,
    },
    redeemModalScrollContent: {
      alignItems: 'center',
      flexGrow: 1,
      justifyContent: 'center',
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    redeemSubmitButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      justifyContent: 'center',
      minHeight: 52,
      paddingHorizontal: spacing.lg,
    },
    redeemSubmitButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '900',
    },
    redeemTitle: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 21,
      fontWeight: '900',
    },
    screen: {
      backgroundColor: colors.appBackground,
      flex: 1,
    },
    secondaryAction: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    secondaryActionText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '800',
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: 19,
      fontWeight: '900',
    },
    subscribeButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      marginTop: spacing.lg,
      minHeight: 56,
      paddingHorizontal: spacing.lg,
    },
    subscribeButtonPressed: {
      opacity: 0.84,
    },
    subscribeButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '900',
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      maxWidth: 340,
      textAlign: 'center',
    },
    terms: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      marginTop: spacing.lg,
      textAlign: 'center',
    },
    title: {
      color: colors.textPrimary,
      fontSize: 36,
      fontWeight: '900',
      letterSpacing: 0,
    },
    titleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
  });
}

let styles = createStyles();
