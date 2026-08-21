/**
 * NDSEP Mobile — Login Screen
 * Opens the Manus OAuth flow in an in-app browser.
 */
import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL = process.env.NDSEP_API_URL ?? "https://ndsep.nitda.gov.ng";

export default function LoginScreen({ onLogin }: { onLogin?: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      // Open OAuth flow in device browser; deep link callback sets the session token
      const loginUrl = `${API_URL}/api/oauth/login?redirect_uri=ndsep://auth/callback`;
      await Linking.openURL(loginUrl);
    } catch (e) {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoArea}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>NG</Text>
        </View>
        <Text style={styles.appName}>NDSEP</Text>
        <Text style={styles.appSubtitle}>National Data Sovereignty{"\n"}Enforcement Platform</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sign In</Text>
        <Text style={styles.cardDesc}>
          Authenticate with your NITDA credentials to access the enforcement platform.
        </Text>
        <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#0a0e1a" />
          ) : (
            <Text style={styles.loginBtnText}>Sign In with NITDA SSO</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.disclaimer}>
          Access restricted to authorised NITDA officers and registered data controllers.
        </Text>
      </View>

      <Text style={styles.version}>v1.0.0 · Secure Government Platform</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0e1a", alignItems: "center", justifyContent: "center", padding: 24 },
  logoArea: { alignItems: "center", marginBottom: 40 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#00d4ff20", borderWidth: 2, borderColor: "#00d4ff", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  logoText: { color: "#00d4ff", fontSize: 28, fontWeight: "900" },
  appName: { color: "#f1f5f9", fontSize: 32, fontWeight: "900", letterSpacing: 4 },
  appSubtitle: { color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 6, lineHeight: 20 },
  card: { width: "100%", backgroundColor: "#0f172a", borderRadius: 16, padding: 24, borderWidth: 1, borderColor: "#1e293b" },
  cardTitle: { color: "#f1f5f9", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  cardDesc: { color: "#94a3b8", fontSize: 14, lineHeight: 22, marginBottom: 24 },
  loginBtn: { backgroundColor: "#00d4ff", borderRadius: 10, paddingVertical: 16, alignItems: "center", marginBottom: 16 },
  loginBtnText: { color: "#0a0e1a", fontSize: 15, fontWeight: "800" },
  disclaimer: { color: "#475569", fontSize: 11, textAlign: "center", lineHeight: 18 },
  version: { color: "#334155", fontSize: 11, marginTop: 32 },
});
