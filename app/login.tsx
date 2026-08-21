import { Link, router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import { getOidcLoginReadiness } from "@/lib/oidc-login-readiness";
import { signInWithPkce } from "@/lib/oidc-session";

const oidc = { issuer: process.env.EXPO_PUBLIC_OIDC_ISSUER ?? "", clientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID ?? "", redirectUri: process.env.EXPO_PUBLIC_OIDC_REDIRECT_URI ?? "idlrpts://oauth/callback" };
export default function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readiness = getOidcLoginReadiness(oidc);
  const login = async () => {
    if (!readiness.ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithPkce(oidc);
      router.replace("/(tabs)");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete enterprise sign-in.");
    } finally {
      setBusy(false);
    }
  };
  return <ScreenContainer><View style={s.page}><View style={s.brandBlock}><Text style={s.eyebrow}>IDLR-PTS</Text><Text style={s.title}>Secure stakeholder access</Text><Text style={s.copy}>Sign in with your approved agency, business, or professional identity. The authorization code flow uses PKCE; on native devices, the resulting session is protected by device biometrics.</Text></View><View style={[s.statusCard, readiness.ready ? s.readyCard : s.unavailableCard]}><Text style={[s.statusTitle, readiness.ready ? s.readyText : s.unavailableText]}>{readiness.ready ? "Enterprise sign-in ready" : "Enterprise sign-in unavailable"}</Text><Text style={s.statusCopy}>{readiness.message}</Text></View><View style={s.steps}><Step number="1" text="Continue to your approved identity provider in a secure browser session." /><Step number="2" text="Return to IDLR-PTS after authorization; no password is handled by this app." /><Step number="3" text="Unlock the stored session with biometrics when the device requests it." /></View>{error ? <View style={s.errorCard}><Text style={s.errorTitle}>Sign-in did not complete</Text><Text style={s.errorCopy}>{error}</Text></View> : null}<Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !readiness.ready }} disabled={busy || !readiness.ready} onPress={login} style={[s.button, (busy || !readiness.ready) && s.disabled]}>{busy ? <View style={s.loadingRow}><ActivityIndicator color="#fff" /><Text style={s.buttonText}>Opening secure sign-in…</Text></View> : <Text style={s.buttonText}>Continue with enterprise sign-in</Text>}</Pressable><Pressable disabled={busy} onPress={() => router.push("/signup" as never)}><Text style={[s.link, busy && s.disabledText]}>New stakeholder? Create an account</Text></Pressable><Link href="/onboarding" style={s.secondary}>View onboarding requirements</Link><Text style={s.note}>A cancelled or rejected sign-in does not create a local session. Contact your agency administrator if the enterprise connection remains unavailable.</Text></View></ScreenContainer>;
}
function Step({ number, text }: { number: string; text: string }) { return <View style={s.step}><View style={s.stepNumber}><Text style={s.stepNumberText}>{number}</Text></View><Text style={s.stepText}>{text}</Text></View>; }
const s=StyleSheet.create({page:{flex:1,justifyContent:"center",padding:24,gap:16},brandBlock:{gap:8},eyebrow:{fontWeight:"700",letterSpacing:1,color:"#0B6E4F"},title:{fontSize:30,fontWeight:"800",color:"#12263A"},copy:{fontSize:16,lineHeight:24,color:"#475467"},statusCard:{borderWidth:1,borderRadius:16,padding:16,gap:6},readyCard:{backgroundColor:"#ECFDF3",borderColor:"#ABEFC6"},unavailableCard:{backgroundColor:"#FFFAEB",borderColor:"#FEDF89"},statusTitle:{fontSize:14,fontWeight:"800"},readyText:{color:"#067647"},unavailableText:{color:"#B54708"},statusCopy:{fontSize:13,lineHeight:19,color:"#475467"},steps:{gap:10},step:{flexDirection:"row",alignItems:"flex-start",gap:10},stepNumber:{width:24,height:24,borderRadius:12,alignItems:"center",justifyContent:"center",backgroundColor:"#E9F7EF"},stepNumberText:{fontSize:12,fontWeight:"800",color:"#0B6E4F"},stepText:{flex:1,fontSize:13,lineHeight:19,color:"#475467"},errorCard:{borderWidth:1,borderColor:"#FECDCA",backgroundColor:"#FEF3F2",borderRadius:16,padding:14,gap:4},errorTitle:{fontSize:14,fontWeight:"800",color:"#B42318"},errorCopy:{fontSize:13,lineHeight:19,color:"#7A271A"},button:{backgroundColor:"#0B6E4F",padding:16,borderRadius:12,alignItems:"center"},disabled:{opacity:.55},loadingRow:{flexDirection:"row",alignItems:"center",gap:10},buttonText:{color:"white",fontWeight:"700"},link:{textAlign:"center",color:"#0B6E4F",fontWeight:"700"},disabledText:{opacity:.5},secondary:{textAlign:"center",color:"#344054"},note:{fontSize:12,lineHeight:18,color:"#667085",textAlign:"center"}});
