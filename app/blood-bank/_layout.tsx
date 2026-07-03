import { Stack } from 'expo-router';

export default function BloodBankLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]" />
      <Stack.Screen name="my-bank" />
      <Stack.Screen name="bank-manage" />
      <Stack.Screen name="inventory" />
      <Stack.Screen name="activity" />
    </Stack>
  );
}
