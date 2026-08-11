const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const androidGradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const iosProject = fs.readFileSync(path.join(root, 'ios/MeetVap.xcodeproj/project.pbxproj'), 'utf8');

const androidVersion = requiredMatch(androidGradle, /versionName\s+"([^"]+)"/, 'Android versionName');
const androidBuild = requiredMatch(androidGradle, /versionCode\s+(\d+)/, 'Android versionCode');
const iosVersions = uniqueMatches(iosProject, /MARKETING_VERSION\s*=\s*([^;]+);/g);
const iosBuilds = uniqueMatches(iosProject, /CURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g);

const errors = [];

if (iosVersions.length !== 1) errors.push(`iOS has inconsistent marketing versions: ${iosVersions.join(', ')}`);
if (iosBuilds.length !== 1) errors.push(`iOS has inconsistent build numbers: ${iosBuilds.join(', ')}`);
if (appConfig.version !== androidVersion || appConfig.version !== iosVersions[0]) {
  errors.push(`Marketing version mismatch: app.json=${appConfig.version}, Android=${androidVersion}, iOS=${iosVersions[0] ?? 'unknown'}`);
}
if (String(appConfig.ios?.buildNumber) !== androidBuild || String(appConfig.ios?.buildNumber) !== iosBuilds[0]) {
  errors.push(`Build number mismatch: app.json=${appConfig.ios?.buildNumber}, Android=${androidBuild}, iOS=${iosBuilds[0] ?? 'unknown'}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Native versions are synchronized: ${appConfig.version} (${androidBuild})`);

function requiredMatch(value, pattern, label) {
  const match = value.match(pattern);
  if (!match) throw new Error(`${label} was not found`);
  return match[1].trim();
}

function uniqueMatches(value, pattern) {
  return [...new Set(Array.from(value.matchAll(pattern), (match) => match[1].trim().replace(/^"|"$/g, '')))].sort();
}
