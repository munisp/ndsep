import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import {
  resolveSessionRefreshConfirmation,
  subscribeSessionNotice,
  type SessionNotice,
} from "@/lib/session-guard";

export function SessionExpiryNotice() {
  const [notice, setNotice] = useState<SessionNotice | null>(null);

  useEffect(() => subscribeSessionNotice(setNotice), []);
  const refreshVisible = notice?.kind === "refresh_confirmation";
  const clearedVisible = notice?.kind === "session_cleared";

  return (
    <>
      <Modal visible={refreshVisible} transparent animationType="fade" onRequestClose={() => resolveSessionRefreshConfirmation(false)}>
        <View className="flex-1 items-center justify-center bg-black/50 px-6">
          <View className="w-full max-w-md rounded-3xl bg-background p-6">
            <Text className="text-xl font-bold text-foreground">Secure session check</Text>
            <Text className="mt-3 text-sm leading-5 text-muted">{refreshVisible ? notice.message : ""}</Text>
            <View className="mt-6 gap-3">
              <Pressable onPress={() => { setNotice(null); resolveSessionRefreshConfirmation(true); }} style={{ opacity: 1 }}>
                <View className="rounded-2xl bg-primary px-4 py-4"><Text className="text-center font-semibold text-white">Verify and continue</Text></View>
              </Pressable>
              <Pressable onPress={() => { setNotice(null); resolveSessionRefreshConfirmation(false); router.replace("/login"); }} style={{ opacity: 1 }}>
                <View className="rounded-2xl border border-border px-4 py-4"><Text className="text-center font-semibold text-foreground">Sign in again</Text></View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {clearedVisible ? <View className="absolute left-4 right-4 top-14 z-50 rounded-2xl border border-warning bg-background p-4 shadow-lg"><Text className="font-semibold text-foreground">Secure session cleared</Text><Text className="mt-1 text-sm leading-5 text-muted">{notice.message}</Text><Pressable onPress={() => { setNotice(null); router.replace("/login"); }} style={{ marginTop: 10 }}><Text className="font-semibold text-primary">Go to sign-in</Text></Pressable></View> : null}
    </>
  );
}
