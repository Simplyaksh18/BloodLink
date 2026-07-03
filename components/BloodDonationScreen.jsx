import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
} from "react-native";

export default function BloodDonationScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <StatusBar barStyle="light-content" backgroundColor="#B71C1C" />

      {/* Header / Nav */}
      <View style={styles.header}>
        <Text style={styles.logoText}>🦁 Leo Club of Hopeville</Text>
        <Text style={styles.tagline}>Youth leadership & service</Text>
        <Text style={styles.sponsored}>Sponsored by Lions Club of Chennai</Text>
      </View>

      {/* Hero Section */}
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Be a Hero.{"\n"}Donate Blood.{"\n"}Save Lives.</Text>
        <Text style={styles.heroSubtitle}>
          Your one donation can save up to three lives.
        </Text>

        {/* CTA Buttons */}
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => console.log("Navigate to Give Blood")}
          >
            <Text style={styles.primaryButtonText}>💉 Give Blood</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => console.log("Navigate to I Need Blood")}
          >
            <Text style={styles.secondaryButtonText}>🩸 I Need Blood</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Why Donate Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Why Donate Blood?</Text>

        <View style={styles.card}>
          <Text style={styles.cardIcon}>❤️</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Save Lives</Text>
            <Text style={styles.cardDescription}>
              Your donation can save up to 3 people in need.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardIcon}>✅</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>It's Easy & Safe</Text>
            <Text style={styles.cardDescription}>
              The process is simple and medically supervised.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardIcon}>⏱️</Text>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Takes 30 Minutes</Text>
            <Text style={styles.cardDescription}>
              That's all it takes to be someone's lifesaver.
            </Text>
          </View>
        </View>
      </View>

      {/* Leo Talk Toggle (from original site) */}
      <View style={styles.leoTalkBar}>
        <Text style={styles.leoTalkText}>Leo Talk: Off – Tap to Enable</Text>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>© 2025 Leo Club – All rights reserved.</Text>
        <Text style={styles.footerSub}>Sponsored by Lions Club of Chennai</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Header / Nav
  header: {
    backgroundColor: "#B71C1C",
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  logoText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  tagline: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
  },
  sponsored: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    marginTop: 2,
  },

  // Hero
  hero: {
    backgroundColor: "#D32F2F",
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 48,
  },
  heroTitle: {
    color: "#fff",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 42,
    marginBottom: 16,
  },
  heroSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 32,
  },

  // CTA Buttons
  ctaRow: {
    flexDirection: "row",
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: "#fff",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#D32F2F",
    fontSize: 16,
    fontWeight: "bold",
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "transparent",
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Why Donate Section
  section: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1A1A1A",
    marginBottom: 20,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFF5F5",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#D32F2F",
  },
  cardIcon: {
    fontSize: 24,
    marginRight: 14,
    marginTop: 2,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: "#555",
    lineHeight: 20,
  },

  // Leo Talk Bar
  leoTalkBar: {
    backgroundColor: "#F5F5F5",
    marginHorizontal: 20,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginBottom: 24,
  },
  leoTalkText: {
    color: "#888",
    fontSize: 13,
  },

  // Footer
  footer: {
    alignItems: "center",
    paddingVertical: 20,
    borderTopWidth: 0.5,
    borderTopColor: "#E0E0E0",
    marginHorizontal: 20,
  },
  footerText: {
    fontSize: 12,
    color: "#999",
  },
  footerSub: {
    fontSize: 11,
    color: "#BBB",
    marginTop: 4,
  },
});
