import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { getUnreadActivityCount, subscribeActivityFeed } from "@/lib/mobile-activity";

function InboxBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <View className="min-w-[18px] rounded-full bg-error px-1.5 py-0.5" style={{ position: "absolute", right: -10, top: -4 }}>
      <Text className="text-center text-[10px] font-bold text-white">{count > 9 ? "9+" : count}</Text>
    </View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [unreadCount, setUnreadCount] = useState(0);
  const [paymentUnread, setPaymentUnread] = useState(0);
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 60 + bottomPadding;

  useEffect(() => {
    const refreshUnread = () => {
      getUnreadActivityCount().then(setUnreadCount).catch(() => undefined);
    };

    refreshUnread();
    const unsubscribe = subscribeActivityFeed(refreshUnread);
    const checkPaymentUnread = async () => { try { const url = `/api/trpc/listPaymentNotifications?input=${encodeURIComponent(JSON.stringify({ applicantId: "demo-user" }))}`; const res = await fetch(url); const json = await res.json(); setPaymentUnread((json?.result?.data ?? []).filter((n: any) => !n.read).length); } catch {} }; checkPaymentUnread(); const paymentInterval = setInterval(checkPaymentUnread, 30000); return () => { unsubscribe(); clearInterval(paymentInterval); };
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          paddingTop: 10,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="parcels"
        options={{
          title: "Parcels",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="building.2.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="field"
        options={{
          title: "Field",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="location.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="geo"
        options={{
          title: "Geo",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="map.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="permits"
        options={{
          title: "Permits",
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="doc.text.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <View>
              <IconSymbol size={24} name="person.crop.circle.fill" color={color} />
              <InboxBadge count={unreadCount + paymentUnread} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
