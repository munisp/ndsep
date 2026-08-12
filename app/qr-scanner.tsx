import { useState, useCallback } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { formatNaira } from "@/lib/payment-domain";

const API_BASE = "/api/trpc";

export default function QRScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);

  async function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    setLookupError(null);

    // Expected format: IDLR-PTS:<reference_number>
    const ref = data.startsWith("IDLR-PTS:") ? data.slice(9) : data;

    try {
      const url = `${API_BASE}/lookupPaymentByReference?input=${encodeURIComponent(JSON.stringify({ referenceNumber: ref }))}`;
      const res = await fetch(url);
      const json = await res.json();
      const payment = json?.result?.data;
      if (payment) {
        setResult(payment);
      } else {
        setLookupError(`No offline payment found for reference: ${ref}`);
      }
    } catch {
      setLookupError("Failed to look up payment. Check network connection.");
    }
  }

  if (Platform.OS === "web") {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-3xl">📷</Text>
          <Text className="text-lg font-bold text-foreground">QR Scanner</Text>
          <Text className="text-sm text-muted text-center">Camera-based QR scanning is available on native iOS and Android devices. Use the web payment history search to look up references manually.</Text>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <View className="rounded-xl border border-primary px-6 py-3 mt-4">
              <Text className="text-center font-semibold text-primary">Return</Text>
            </View>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (!permission?.granted) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-3xl">📷</Text>
          <Text className="text-lg font-bold text-foreground">Camera Permission Required</Text>
          <Text className="text-sm text-muted text-center">Grant camera access to scan payment receipt QR codes.</Text>
          <Pressable onPress={requestPermission} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <View className="rounded-xl bg-primary px-6 py-3 mt-4">
              <Text className="text-center font-semibold text-white">Grant Permission</Text>
            </View>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="flex-1">
        {!scanned && (
          <CameraView
            style={{ flex: 1 }}
            enableTorch={torchOn}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarCodeScanned}
          >
            <View className="flex-1 items-center justify-center">
              <View className="w-64 h-64 border-2 border-white/50 rounded-3xl" />
              <Text className="text-white text-sm mt-4">Align QR code within the frame</Text>
              <Pressable onPress={() => setTorchOn(!torchOn)} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, marginTop: 20 }]}>
                <View className={`rounded-full px-5 py-2 ${torchOn ? "bg-warning" : "bg-white/20"}`}>
                  <Text className={`text-sm font-semibold ${torchOn ? "text-black" : "text-white"}`}>
                    {torchOn ? "🔦 Light ON" : "🔦 Light OFF"}
                  </Text>
                </View>
              </Pressable>
            </View>
          </CameraView>
        )}

        {scanned && (
          <View className="flex-1 p-6 justify-center gap-4">
            {result && (
              <View className="rounded-2xl border border-border bg-surface p-5 gap-3">
                <Text className="text-lg font-bold text-foreground">Payment Found</Text>
                <View className="flex-row justify-between"><Text className="text-xs text-muted">Reference</Text><Text className="text-xs font-semibold text-foreground">{result.referenceNumber}</Text></View>
                <View className="flex-row justify-between"><Text className="text-xs text-muted">Amount</Text><Text className="text-sm font-bold text-foreground">{formatNaira(result.amount)}</Text></View>
                <View className="flex-row justify-between"><Text className="text-xs text-muted">Description</Text><Text className="text-xs text-foreground">{result.description}</Text></View>
                <View className="flex-row justify-between"><Text className="text-xs text-muted">Method</Text><Text className="text-xs text-foreground">{result.method}</Text></View>
                <View className="flex-row justify-between"><Text className="text-xs text-muted">Status</Text><Text className={`text-xs font-bold ${result.status === "approved" ? "text-success" : result.status === "rejected" ? "text-error" : "text-warning"}`}>{result.status}</Text></View>
                <View className="flex-row justify-between"><Text className="text-xs text-muted">Gateway Verified</Text><Text className="text-xs font-bold text-error">No</Text></View>
                <View className="mt-2 rounded-xl border border-warning bg-warning/5 p-2">
                  <Text className="text-[10px] text-warning">⚠ This is an offline payment record. It has NOT been verified by any payment gateway.</Text>
                </View>
              </View>
            )}

            {lookupError && (
              <View className="rounded-2xl border border-error bg-error/5 p-5">
                <Text className="text-sm font-semibold text-error">Not Found</Text>
                <Text className="text-xs text-muted mt-2">{lookupError}</Text>
              </View>
            )}

            <Pressable onPress={() => { setScanned(false); setResult(null); setLookupError(null); }} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <View className="rounded-xl bg-primary px-6 py-3">
                <Text className="text-center font-semibold text-white">Scan Another</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <View className="px-4 py-3">
                <Text className="text-center font-semibold text-muted">Return</Text>
              </View>
            </Pressable>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}
