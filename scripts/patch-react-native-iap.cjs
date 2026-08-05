const fs = require('fs');
const path = require('path');

const androidFilePath = path.resolve(__dirname, '../node_modules/react-native-iap/android/src/play/java/com/dooboolab/rniap/RNIapModule.kt');

if (fs.existsSync(androidFilePath)) {
  const source = fs.readFileSync(androidFilePath, 'utf8');
  const patched = source
    .replace('val activity = currentActivity', 'val activity = reactContext.currentActivity')
    .replace(
      'import com.android.billingclient.api.ProductDetails\n',
      'import com.android.billingclient.api.PendingPurchasesParams\nimport com.android.billingclient.api.ProductDetails\n',
    )
    .replace(
      /(?:import com\.android\.billingclient\.api\.PendingPurchasesParams\n){2,}/g,
      'import com.android.billingclient.api.PendingPurchasesParams\n',
    )
    .replace(
      'BillingClient.newBuilder(reactContext).enablePendingPurchases(),',
      'BillingClient.newBuilder(reactContext).enablePendingPurchases(\n' +
        '        PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),\n' +
        '    ),',
    )
    .replace(
      'billingClient.queryProductDetailsAsync(params) { billingResult, skuDetailsList ->',
      'billingClient.queryProductDetailsAsync(params) { billingResult, productDetailsResult ->\n' +
        '                val skuDetailsList = productDetailsResult.productDetailsList',
    )
    .replace('import com.android.billingclient.api.PurchaseHistoryRecord\n', '')
    .replace('import com.android.billingclient.api.QueryPurchaseHistoryParams\n', '')
    .replace('billingClient.queryPurchaseHistoryAsync(', 'billingClient.queryPurchasesAsync(')
    .replace('QueryPurchaseHistoryParams\n', 'QueryPurchasesParams\n')
    .replace(
      ') { billingResult: BillingResult, purchaseHistoryRecordList: MutableList<PurchaseHistoryRecord>? ->',
      ') { billingResult: BillingResult, purchaseHistoryRecordList: List<Purchase> ->',
    )
    .replace('return@queryPurchaseHistoryAsync', 'return@queryPurchasesAsync');

  const billing8PatchApplied = patched.includes('PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()') &&
    patched.includes('val skuDetailsList = productDetailsResult.productDetailsList') &&
    !patched.includes('queryPurchaseHistoryAsync');

  if (!billing8PatchApplied) {
    throw new Error('Could not apply the react-native-iap Google Play Billing 8 compatibility patch.');
  }

  if (patched !== source) {
    fs.writeFileSync(androidFilePath, patched);
    console.log('Patched react-native-iap Android and Google Play Billing 8 compatibility.');
  }
}

const podspecPath = path.resolve(__dirname, '../node_modules/react-native-iap/RNIap.podspec');

if (fs.existsSync(podspecPath)) {
  const source = fs.readFileSync(podspecPath, 'utf8');
  const patched = source.replace(/\n\s*s\.dependency "RCT-Folly"\n/, '\n');

  if (patched !== source) {
    fs.writeFileSync(podspecPath, patched);
    console.log('Patched react-native-iap iOS RCT-Folly pod dependency compatibility.');
  }
}
