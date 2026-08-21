import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";

import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { paymentScanFeedback } from "@/lib/payment-scan-feedback";

const successSound = require("../assets/audio/receipt-scan-success.wav");
const errorSound = require("../assets/audio/receipt-scan-error.wav");

function normaliseReference(value: string) {
  try {
    const parsed = JSON.parse(value) as { reference?: unknown };
    if (typeof parsed.reference === "string") return parsed.reference.trim();
  } catch {
    // Receipt QR payloads may intentionally contain the plain reference string.
  }
  return value.trim();
}

function ScanOutcomeBadge({ outcome }: { outcome: "approved" | "pending_review" | "awaiting_second_approval" | "rejected" | "not_found" }) {
  const state = outcome === "approved" ? "success" : outcome === "pending_review" || outcome === "awaiting_second_approval" ? "warning" : "error";
  const label = outcome === "approved" ? "Approved" : outcome === "pending_review" ? "Pending review" : outcome === "awaiting_second_approval" ? "Second approval required" : outcome === "rejected" ? "Rejected" : "Not found";
  return <View className={`rounded-full px-2 py-1 ${state === "success" ? "bg-success/10" : state === "warning" ? "bg-warning/10" : "bg-error/10"}`}><Text className={`text-[10px] font-bold uppercase ${state === "success" ? "text-success" : state === "warning" ? "text-warning" : "text-error"}`}>{label}</Text></View>;
}

export default function QrScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const isFocused = useIsFocused();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const successPlayer = useAudioPlayer(successSound);
  const errorPlayer = useAudioPlayer(errorSound);
  const verifyReceipt = trpc.paymentOperations.verifyReceiptAndLog.useMutation();
  const history = trpc.paymentOperations.scanHistory.useQuery({ limit: 25 }, { retry: false });
  const scanningEnabled = Boolean(permission?.granted && isFocused && !verifyReceipt.isPending);

  useEffect(() => { if (Platform.OS !== "web") void setAudioModeAsync({ playsInSilentMode: true }); }, []);

  async function giveScanFeedback(kind: "success" | "error") {
    try {
      const player = kind === "success" ? successPlayer : errorPlayer;
      player.seekTo(0);
      player.play();
    } catch {
      // Audio feedback is non-authoritative UI feedback; the verified result remains visible.
    }
    if (Platform.OS !== "web") await Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  }

  async function onBarcodeScanned(result: BarcodeScanningResult) {
    if (verifyReceipt.isPending) return;
    const reference = normaliseReference(result.data);
    if (reference.length < 3) {
      setResultMessage("The scanned QR code did not contain a usable payment reference.");
      await giveScanFeedback("error");
      return;
    }
    setResultMessage("Checking receipt against the offline-payment review record…");
    try {
      const verified = await verifyReceipt.mutateAsync({ reference });
      const label = verified.scan.outcome === "approved" ? "Receipt record approved by administrator." : verified.scan.outcome === "pending_review" ? "Receipt found, but it is still awaiting administrator review." : verified.scan.outcome === "rejected" ? "Receipt record was rejected by administrator review." : "No offline-payment record matches this reference.";
      setResultMessage(label);
      await giveScanFeedback(paymentScanFeedback(verified.scan.outcome));
      await history.refetch();
    } catch (error) {
      setResultMessage(error instanceof Error ? error.message : "Receipt verification could not be completed.");
      await giveScanFeedback("error");
    }
  }

  if (!permission) return <ScreenContainer className="items-center justify-center bg-background"><Text className="text-muted">Checking camera permission…</Text></ScreenContainer>;

  if (!permission.granted) {
    return <ScreenContainer className="items-center justify-center bg-background p-6"><View className="rounded-3xl border border-border bg-surface p-6"><Text className="text-xl font-bold text-foreground">Camera access required</Text><Text className="mt-2 text-sm leading-5 text-muted">Receipt verification scans a QR code using the device camera. The camera is not opened until permission is granted.</Text><Pressable onPress={() => void requestPermission()} style={({ pressed }) => [{ opacity: pressed ? 0.78 : 1 }]}><View className="mt-5 rounded-2xl bg-primary px-4 py-4"><Text className="text-center font-semibold text-white">Grant camera access</Text></View></Pressable></View></ScreenContainer>;
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View className="rounded-[28px] bg-surface p-5"><Text className="text-sm text-muted">Administrator receipt verification</Text><Text className="mt-2 text-3xl font-bold text-foreground">Scan payment receipt</Text><Text className="mt-2 text-sm leading-5 text-muted">This reads the QR reference, checks the administrator-reviewed offline-payment record, and records the lookup in your staff scan history. It does not validate bank settlement or gateway processing.</Text></View>

        <View className="overflow-hidden rounded-3xl border border-border bg-black" style={{ height: 300 }}>
          {scanningEnabled ? <CameraView style={{ flex: 1 }} facing="back" enableTorch={torchEnabled} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onBarcodeScanned} /> : <View className="flex-1 items-center justify-center bg-surface px-5"><Text className="text-center text-sm text-muted">{verifyReceipt.isPending ? "Verifying the scanned receipt…" : "Scanner is paused while this page is not active."}</Text></View>}
          <View style={{ position: "absolute", right: 14, bottom: 14 }}><Pressable onPress={() => setTorchEnabled((current) => !current)} disabled={!scanningEnabled} style={({ pressed }) => [{ opacity: pressed || !scanningEnabled ? 0.65 : 1 }]}><View className="rounded-full bg-black/70 px-4 py-3"><Text className="font-semibold text-white">{torchEnabled ? "Torch on" : "Torch off"}</Text></View></Pressable></View>
        </View>

        {resultMessage ? <View className={`rounded-2xl border p-4 ${verifyReceipt.isError ? "border-error bg-error/5" : "border-primary bg-primary/5"}`}><Text className="text-sm leading-5 text-foreground">{resultMessage}</Text></View> : null}

        <View className="rounded-3xl border border-border bg-surface p-5"><View className="flex-row items-center justify-between"><View><Text className="text-lg font-semibold text-foreground">Recent receipt scans</Text><Text className="mt-1 text-sm text-muted">Stored against your administrator account.</Text></View><Pressable onPress={() => void history.refetch()} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}><Text className="text-sm font-semibold text-primary">Refresh</Text></Pressable></View>{history.isError ? <View className="mt-4 rounded-2xl border border-warning bg-warning/5 p-4"><Text className="text-sm font-semibold text-warning">Administrator session required</Text><Text className="mt-2 text-xs leading-4 text-muted">Receipt verification history is not exposed without an authorised administrator session.</Text></View> : history.isLoading ? <Text className="mt-4 text-sm text-muted">Loading scan history…</Text> : history.data?.length ? <View className="mt-4 gap-3">{history.data.map((scan) => <View key={scan.id} className="rounded-2xl border border-border bg-background p-4"><View className="flex-row items-center justify-between gap-3"><Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>{scan.reference}</Text><ScanOutcomeBadge outcome={scan.outcome} /></View><Text className="mt-2 text-xs text-muted">Scanned {new Date(scan.scannedAt).toLocaleString()}</Text></View>)}</View> : <View className="mt-4 rounded-2xl border border-border bg-background p-4"><Text className="text-sm font-semibold text-foreground">No scan history yet</Text><Text className="mt-2 text-xs leading-4 text-muted">Verified, pending, rejected, and not-found receipt lookups will be recorded here after a staff member scans a QR receipt.</Text></View>}</View>
      </ScrollView>
    </ScreenContainer>
  );
}
