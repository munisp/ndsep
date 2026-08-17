// @ts-nocheck
// Proposed native screen. Requires a custom development/production build with react-native-passkey.
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Passkey } from "react-native-passkey";
import { useLocalSearchParams } from "expo-router";
import { trpc } from "@/lib/trpc";
import { ScreenContainer } from "@/components/screen-container";

export default function DualApprovalPasskeyScreen() {
  const { authorizationId } = useLocalSearchParams<{authorizationId:string}>();
  const [busy, setBusy] = useState(false);
  const detail = trpc.recovery.authorization.useQuery({ authorizationId });
  const approve = trpc.recovery.approveWithPasskey.useMutation();
  const sign = async () => {
    if (!detail.data || busy) return;
    setBusy(true);
    try {
      const assertion = await Passkey.get({ challenge: detail.data.webauthnChallenge, rpId: detail.data.rpId, userVerification: "required" });
      await approve.mutateAsync({ authorizationId, assertion, deviceFingerprint: detail.data.targetDeviceFingerprint });
      Alert.alert("Approval recorded", "A second, distinct required approver is still required before replay can be authorised.");
      await detail.refetch();
    } catch (error) {
      Alert.alert("Passkey approval not recorded", error instanceof Error ? error.message : "Use an enrolled enterprise passkey and try again.");
    } finally { setBusy(false); }
  };
  if (detail.isLoading) return <ScreenContainer><ActivityIndicator /></ScreenContainer>;
  if (detail.error || !detail.data) return <ScreenContainer><Text style={s.error}>Recovery request unavailable. It may be expired or you may not be an assigned approver.</Text></ScreenContainer>;
  return <ScreenContainer><ScrollView contentContainerStyle={s.page}>
    <Text style={s.title}>Approve secure replay</Text><Text style={s.note}>Use your enrolled enterprise passkey. This approval is bound to one payload hash, device, and expiry.</Text>
    <View style={s.card}><Text>Queue ID: {detail.data.queueId}</Text><Text>Payload hash: {detail.data.payloadHash}</Text><Text>Target device: {detail.data.targetDeviceFingerprint}</Text><Text>Expires: {new Date(detail.data.expiresAt).toLocaleString()}</Text><Text>Required roles: Security engineer + planning supervisor</Text></View>
    <Pressable disabled={busy || detail.data.status !== "pending"} onPress={sign} style={[s.button,(busy || detail.data.status !== "pending") && s.disabled]}><Text style={s.buttonText}>{busy ? "Verifying passkey…" : "Sign approval with passkey"}</Text></Pressable>
  </ScrollView></ScreenContainer>;
}
const s = StyleSheet.create({page:{padding:20,gap:16},title:{fontSize:26,fontWeight:"700"},note:{color:"#475467",lineHeight:20},card:{gap:8,padding:16,borderRadius:12,backgroundColor:"#F8FAFC"},button:{backgroundColor:"#0B6E4F",padding:15,borderRadius:10,alignItems:"center"},disabled:{opacity:.5},buttonText:{color:"white",fontWeight:"700"},error:{padding:20,color:"#B42318"}});
