# BloodLink — App Store Submission Checklist

## Both Stores

- [ ] App version and build number bumped in `app.json` (`version`, `ios.buildNumber`, `android.versionCode`)
- [ ] All screens tested on both iOS and Android (physical device preferred)
- [ ] Deep links / universal links configured if used
- [ ] No hardcoded dev API URLs (all point to production `https://api.bloodlink.app`)
- [ ] `USE_DUMMY_DATA=false` in production build environment
- [ ] Firebase `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) are production credentials
- [ ] Push notification entitlements configured (APNs cert / FCM key)
- [ ] App tested with notifications permission denied (graceful fallback)
- [ ] All debug logs / console output removed or behind `__DEV__` guards
- [ ] Privacy policy URL live and accessible
- [ ] Terms of service URL live and accessible
- [ ] App icon: 1024×1024 PNG, no rounded corners, no alpha
- [ ] Splash screen: correct dimensions, no text that overlaps safe areas
- [ ] Permissions declared with usage description strings:
  - Camera (document upload)
  - Photo library (document selection)
  - Location (donor discovery radius)
  - Notifications (blood request alerts)

## Expo Build

```bash
# Production build
eas build --platform all --profile production

# Submit
eas submit --platform ios
eas submit --platform android
```

- [ ] `eas.json` has a `production` profile pointing to correct bundle ID / package name
- [ ] `app.json` `bundleIdentifier` (iOS) and `package` (Android) match store listings
- [ ] OTA updates policy configured in `eas.json` (or disabled for initial submission)

## iOS — App Store Connect

- [ ] Bundle ID registered in Apple Developer portal
- [ ] App created in App Store Connect
- [ ] App category: Health & Fitness
- [ ] Age rating: 4+ (no objectionable content)
- [ ] Screenshots provided for iPhone 6.5" and 5.5"
- [ ] App preview video (optional but recommended)
- [ ] Keywords (max 100 chars): blood donation, donor, blood bank, emergency, health
- [ ] Privacy Nutrition Label completed:
  - Data collected: Name, Phone, Location, Health (blood group), Usage data
  - Data linked to user: Yes
  - Data used for app functionality: Yes
- [ ] Exporting compliance: No encryption beyond standard HTTPS
- [ ] `NSHealthShareUsageDescription` NOT needed (we don't use HealthKit)
- [ ] TestFlight beta distributed to ≥ 5 internal testers and passed
- [ ] App Review notes: explain blood donation use case, OTP login flow

## Android — Google Play Console

- [ ] App signing configured (upload key vs app signing key)
- [ ] Target API level: 34+ (Android 14)
- [ ] Package name registered
- [ ] Store listing: short description (80 chars) + full description
- [ ] Feature graphic: 1024×500 PNG
- [ ] Screenshots: ≥ 2 for phone
- [ ] Content rating questionnaire completed (Medical apps category)
- [ ] Data safety form completed (location collected, blood group collected)
- [ ] Internal test → Closed test → Open test → Production rollout (20% first)
- [ ] `android.permissions` in `app.json` matches actual usage
- [ ] ProGuard / R8 minification tested (no runtime crashes from reflection)

## Final Sanity Before Submit

- [ ] Cold launch on fresh install — no crash on first open
- [ ] Onboarding flow: register → OTP → donor profile → document upload — end-to-end clean
- [ ] Find Blood flow: request blood → see donor list → message donor — end-to-end clean
- [ ] Give Blood flow: see requests → accept → proof upload — end-to-end clean
- [ ] Push notification received on background and foreground
- [ ] App works on slow network (3G throttle test)
- [ ] App gracefully handles API down (offline state, error screens)
- [ ] No ANRs (Android) or main-thread hangs > 16 ms
