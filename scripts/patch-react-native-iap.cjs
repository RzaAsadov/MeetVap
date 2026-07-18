const fs = require('fs');
const path = require('path');

const androidFilePath = path.resolve(__dirname, '../node_modules/react-native-iap/android/src/play/java/com/dooboolab/rniap/RNIapModule.kt');

if (fs.existsSync(androidFilePath)) {
  const source = fs.readFileSync(androidFilePath, 'utf8');
  const patched = source.replace('val activity = currentActivity', 'val activity = reactContext.currentActivity');

  if (patched !== source) {
    fs.writeFileSync(androidFilePath, patched);
    console.log('Patched react-native-iap Android currentActivity compatibility.');
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
