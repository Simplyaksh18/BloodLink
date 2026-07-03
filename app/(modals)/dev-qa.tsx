/**
 * Retired route. The Developer QA Panel has been removed from the app.
 * The file is preserved so Expo Router doesn't fail on any lingering
 * deep-link reference; anyone hitting this path is bounced home.
 */

import { Redirect } from 'expo-router';

export default function DevQaScreen() {
  return <Redirect href="/(tabs)" />;
}
