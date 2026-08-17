import { Link, router } from "expo-router";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { signInWithPkce } from "@/lib/oidc-session";

const oidc = { issuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? "", clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? "", redirectUri: process.env.EXPO_PUBLIC_OIDC_REDIRECT_URI ?? "idlrpts://oauth/callback" };
export default function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const login = async () => { setBusy(true); try { await signInWithPkce(oidc); router.replace("/(tabs)"); } catch (e) { Alert.alert("Sign-in unavailable", e instanceof Error ? e.message : "Unable to sign in."); } finally { setBusy(false); } };
  return <ScreenContainer><View style={s.page}><Text style={s.eyebrow}>IDLR-PTS</Text><Text style={s.title}>Secure stakeholder access</Text><Text style={s.copy}>Sign in with your approved agency, business, or professional identity. Sign-in uses an OIDC authorization code with PKCE and stores native sessions behind device biometrics.</Text><Pressable disabled={busy} onPress={login} style={[s.button,busy&&s.disabled]}>{busy?<ActivityIndicator color="#fff"/>:<Text style={s.buttonText}>Continue securely</Text>}</Pressable><Pressable onPress={() => router.push("/signup" as never)}><Text style={s.link}>New stakeholder? Create an account</Text></Pressable><Link href="/onboarding" style={s.secondary}>View onboarding requirements</Link><Text style={s.note}>If enterprise sign-in is not configured, this action remains unavailable by design.</Text></View></ScreenContainer>;
}
const s=StyleSheet.create({page:{flex:1,justifyContent:"center",padding:24,gap:16},eyebrow:{fontWeight:"700",color:"#0B6E4F"},title:{fontSize:30,fontWeight:"800",color:"#12263A"},copy:{fontSize:16,lineHeight:24,color:"#475467"},button:{backgroundColor:"#0B6E4F",padding:16,borderRadius:12,alignItems:"center"},disabled:{opacity:.55},buttonText:{color:"white",fontWeight:"700"},link:{textAlign:"center",color:"#0B6E4F",fontWeight:"700"},secondary:{textAlign:"center",color:"#344054"},note:{fontSize:12,lineHeight:18,color:"#667085",textAlign:"center"}});
