import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: 'Not Found', headerShown: true }} />
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={72} color="#E74C3C" />
        <Text style={styles.title}>Page Not Found</Text>
        <Text style={styles.subtitle}>The screen you're looking for doesn't exist.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.btnText}>Go to Home</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: '#222',
  },
  subtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
  },
  btn: {
    marginTop: 8,
    backgroundColor: '#E74C3C',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#fff',
  },
});
