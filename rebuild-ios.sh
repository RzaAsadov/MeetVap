#!/bin/bash
set -e

# ─────────────────────────────────────────
# iOS Build & Upload to TestFlight
#
# Usage:
#   ./build_testflight.sh                   # auto-increment patch + build
#   ./build_testflight.sh --info            # print current version/build, exit
#   ./build_testflight.sh 1.4.5             # set version, auto-increment build
#   ./build_testflight.sh 1.4.5 126         # set both explicitly
#   ./build_testflight.sh --bump-minor      # bump minor (13.9 → 13.10), auto-increment build
#   ./build_testflight.sh --bump-major      # bump major (13.9 → 14.0),  auto-increment build
#   ./build_testflight.sh --bump-patch      # bump patch (1.4.5 → 1.4.6), auto-increment build
# ─────────────────────────────────────────

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()   { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
header() { echo -e "${CYAN}$1${NC}"; }

# ── Parse args ──
INFO_MODE=false
BUMP_MODE=""
VERSION_ARG=""
BUILD_ARG=""

for arg in "$@"; do
  case "$arg" in
    --info)        INFO_MODE=true ;;
    --bump-major)  BUMP_MODE="major" ;;
    --bump-minor)  BUMP_MODE="minor" ;;
    --bump-patch)  BUMP_MODE="patch" ;;
    --*)           error "Unknown flag: $arg" ;;
    *)
      if [ -z "$VERSION_ARG" ]; then VERSION_ARG="$arg"
      elif [ -z "$BUILD_ARG" ]; then BUILD_ARG="$arg"
      fi ;;
  esac
done

# ── Detect project file ──
detect_project() {
  local search_dirs=("./ios" ".")
  for dir in "${search_dirs[@]}"; do
    local ws
    ws=$(find "$dir" -maxdepth 1 -name "*.xcworkspace" \
      ! -path "*/xcshareddata/*" ! -path "*/DerivedData/*" | head -1)
    if [ -n "$ws" ]; then echo "$ws"; return; fi
    local proj
    proj=$(find "$dir" -maxdepth 1 -name "*.xcodeproj" ! -path "*/DerivedData/*" | head -1)
    if [ -n "$proj" ]; then echo "$proj"; return; fi
  done
  error "No .xcworkspace or .xcodeproj found in ./ios or root."
}

# ── Detect scheme ──
detect_scheme() {
  # Best source: xcscheme files inside the app's own xcodeproj (not Pods, not workspace)
  local scheme
  scheme=$(find ./ios -maxdepth 5 -name "*.xcscheme"     -path "*/xcodeproj/xcshareddata/xcschemes/*"     ! -path "*/Pods/*"     ! -path "*/DerivedData/*"     | xargs -I{} basename {} .xcscheme     | grep -v "Tests\|Test"     | head -1)

  # Fallback: any xcshareddata scheme outside Pods
  if [ -z "$scheme" ]; then
    scheme=$(find ./ios -maxdepth 6 -name "*.xcscheme"       -path "*/xcshareddata/xcschemes/*"       ! -path "*/Pods/*"       ! -path "*/DerivedData/*"       | xargs -I{} basename {} .xcscheme       | grep -v "Tests\|Test"       | head -1)
  fi

  echo "$scheme"
}

# ── Detect Team ID (from pbxproj only, no xcodebuild) ──
detect_team_id() {
  local pbxproj="$1"
  get_pbxproj_value "DEVELOPMENT_TEAM" "$pbxproj"
}

# ── Detect Bundle ID ──
detect_bundle_id() {
  local pbxproj="$1"
  get_pbxproj_value "PRODUCT_BUNDLE_IDENTIFIER" "$pbxproj"
}

# ── Find project.pbxproj ──
find_pbxproj() {
  find ./ios -maxdepth 3 -name "project.pbxproj" ! -path "*/DerivedData/*" | head -1
}

# ── Read build setting from pbxproj (first occurrence) ──
get_pbxproj_value() {
  local key="$1" file="$2"
  grep "\b${key}\b" "$file" \
    | grep -v "^[[:space:]]*//" \
    | awk -F'=' '{print $2}' \
    | tr -d ' ;"' \
    | grep -v '^\s*$' \
    | head -1
}

# ── Set ALL occurrences of a build setting in pbxproj ──
set_pbxproj_value() {
  local key="$1" value="$2" file="$3"
  local tmp="${file}.bak"
  sed "s|\(${key} = \)[^;]*;|\1${value};|g" "$file" > "$tmp" && mv "$tmp" "$file"
}

# ── Version bump: supports 2-part (13.9) and 3-part (1.4.5) ──
bump_version() {
  local version="$1" mode="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$version"
  major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-}"

  case "$mode" in
    major) major=$(( major + 1 )); minor=0; [ -n "$patch" ] && patch=0 ;;
    minor) minor=$(( minor + 1 )); [ -n "$patch" ] && patch=0 ;;
    patch)
      if [ -n "$patch" ]; then patch=$(( patch + 1 ))
      else minor=$(( minor + 1 )); fi ;;
  esac

  [ -n "$patch" ] && echo "${major}.${minor}.${patch}" || echo "${major}.${minor}"
}

# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────

PBXPROJ=$(find_pbxproj)
[ -z "$PBXPROJ" ] && error "Could not find project.pbxproj"

# Read from pbxproj — works whether Info.plist uses hardcoded values or $(MARKETING_VERSION)
CURRENT_VERSION=$(get_pbxproj_value "MARKETING_VERSION" "$PBXPROJ")
CURRENT_BUILD=$(get_pbxproj_value "CURRENT_PROJECT_VERSION" "$PBXPROJ")

# Fallback: if project uses hardcoded values in Info.plist (older setup)
if [ -z "$CURRENT_VERSION" ] || [ -z "$CURRENT_BUILD" ]; then
  PLIST=$(find ./ios -maxdepth 2 -name "Info.plist" \
    ! -path "*/Tests/*" ! -path "*/DerivedData/*" | head -1)
  [ -n "$PLIST" ] && {
    [ -z "$CURRENT_VERSION" ] && \
      CURRENT_VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$PLIST" 2>/dev/null)
    [ -z "$CURRENT_BUILD" ] && \
      CURRENT_BUILD=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$PLIST" 2>/dev/null)
  }
fi

[ -z "$CURRENT_VERSION" ] && error "Could not read current version."
[ -z "$CURRENT_BUILD" ]   && error "Could not read current build number."

# ── --info mode ──
if $INFO_MODE; then
  header "────────────────────────────────────────"
  header "  App Version Info"
  header "────────────────────────────────────────"
  echo -e "  Source  : $PBXPROJ"
  echo -e "  Version : ${CYAN}${CURRENT_VERSION}${NC}"
  echo -e "  Build   : ${CYAN}${CURRENT_BUILD}${NC}"
  header "────────────────────────────────────────"
  exit 0
fi

# ── Resolve new version ──
if [ -n "$VERSION_ARG" ]; then
  NEW_VERSION="$VERSION_ARG"
elif [ -n "$BUMP_MODE" ]; then
  NEW_VERSION=$(bump_version "$CURRENT_VERSION" "$BUMP_MODE")
else
  NEW_VERSION=$(bump_version "$CURRENT_VERSION" "patch")
fi

# ── Resolve new build ──
if [ -n "$BUILD_ARG" ]; then
  NEW_BUILD="$BUILD_ARG"
else
  NEW_BUILD=$(( CURRENT_BUILD + 1 ))
fi

# ── Print plan & confirm ──
header "────────────────────────────────────────"
header "  Version Plan"
header "────────────────────────────────────────"
echo -e "  Version : ${YELLOW}${CURRENT_VERSION}${NC}  →  ${GREEN}${NEW_VERSION}${NC}"
echo -e "  Build   : ${YELLOW}${CURRENT_BUILD}${NC}  →  ${GREEN}${NEW_BUILD}${NC}"
header "────────────────────────────────────────"
read -rp "Proceed with build? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── Detect project / scheme / team ──
BUILD_DIR="$(pwd)/build"
ARCHIVE_PATH="$BUILD_DIR/app.xcarchive"
EXPORT_PATH="$BUILD_DIR/export"
EXPORT_PLIST="$BUILD_DIR/ExportOptions.plist"

info "Detecting project..."
PROJECT=$(detect_project)
[[ "$PROJECT" == *.xcworkspace ]] && PROJECT_FLAG="-workspace" || PROJECT_FLAG="-project"
info "  Project : $PROJECT"

info "Detecting scheme..."
SCHEME=$(detect_scheme "$PROJECT")
[ -z "$SCHEME" ] && error "Could not detect scheme."
info "  Scheme  : $SCHEME"

info "Detecting Team ID..."
TEAM_ID=$(detect_team_id "$PBXPROJ")
[ -z "$TEAM_ID" ] && error "Could not detect DEVELOPMENT_TEAM."
info "  Team ID : $TEAM_ID"

BUNDLE_ID=$(detect_bundle_id "$PBXPROJ")
[ -n "$BUNDLE_ID" ] && info "  Bundle  : $BUNDLE_ID"

# ── Apply version & build to pbxproj ──
info "  Updating pbxproj..."
set_pbxproj_value "MARKETING_VERSION"       "$NEW_VERSION" "$PBXPROJ"
set_pbxproj_value "CURRENT_PROJECT_VERSION" "$NEW_BUILD"   "$PBXPROJ"
info "  pbxproj updated → v${NEW_VERSION} (${NEW_BUILD})"

mkdir -p "$BUILD_DIR"

# ── Write ExportOptions.plist ──
cat > "$EXPORT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>destination</key>
  <string>upload</string>
  <key>uploadSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
EOF

# ── Archive ──
info "Archiving (Release)..."
xcodebuild archive \
  $PROJECT_FLAG "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -archivePath "$ARCHIVE_PATH" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  | xcpretty 2>/dev/null || true

[ -d "$ARCHIVE_PATH" ] || error "Archive failed — $ARCHIVE_PATH not found."
info "Archive done."

# ── Export & Upload ──
info "Exporting & uploading to TestFlight..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  | xcpretty 2>/dev/null || true

header "────────────────────────────────────────"
header "  Done!  v${NEW_VERSION} (${NEW_BUILD}) → TestFlight"
header "  Check App Store Connect → TestFlight."
header "────────────────────────────────────────"