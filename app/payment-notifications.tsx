import { useState, useEffect } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";

const API_BASE = "/api/trpc";

type PaymentNotification = {
  id: string;
  applicantId: string;
  type: "payment_approved" | "payment_rejected";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};

export default function PaymentNotificationsScreen() {
  const [notifications, setNotifications] = useState<PaymentNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadNotifications(); }, []);

  async function loadNotifications() {
    setLoading(true);
    try {
      const url = `${API_BASE}/listPaymentNotifications?input=${encodeURIComponent(JSON.stringify({ applicantId: "demo-user" }))}`;
      const res = await fetch(url);
      const json = await res.json();
      setNotifications((json?.result?.data ?? []) as PaymentNotification[]);
    } catch { setNotifications([]); }
    setLoading(false);
  }

  async function markRead(id: string) {
    try {
      await fetch(`${API_BASE}/markPaymentNotificationRead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id }),
      });
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch {}
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <ScreenContainer className="p-6">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="flex-1 gap-6">
          <View className="flex-row items-center gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-2xl font-bold text-foreground">Payment Alerts</Text>
              <Text className="text-sm text-muted">Approval and rejection notifications</Text>
            </View>
            {unreadCount > 0 && (
              <View className="rounded-full bg-error px-3 py-1">
                <Text className="text-xs font-bold text-white">{unreadCount} new</Text>
              </View>
            )}
          </View>

          {loading && <Text className="text-sm text-muted text-center p-8">Loading…</Text>}

          {!loading && notifications.length === 0 && (
            <View className="items-center p-8">
              <Text className="text-3xl mb-2">🔔</Text>
              <Text className="text-sm text-muted">No payment notifications yet.</Text>
            </View>
          )}

          <View className="gap-3">
            {notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((notif) => (
              <Pressable key={notif.id} onPress={() => markRead(notif.id)} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
                <View className={`rounded-2xl border p-4 gap-2 ${!notif.read ? "border-primary bg-primary/5" : "border-border bg-surface"}`}>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm">{notif.type === "payment_approved" ? "✅" : "❌"}</Text>
                    <Text className="text-sm font-semibold text-foreground flex-1">{notif.title}</Text>
                    {!notif.read && <View className="w-2 h-2 rounded-full bg-primary" />}
                  </View>
                  <Text className="text-xs text-muted leading-4">{notif.message}</Text>
                  <Text className="text-[10px] text-muted">{new Date(notif.createdAt).toLocaleString("en-NG")}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
            <View className="px-4 py-3">
              <Text className="text-center font-semibold text-muted">Return</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
