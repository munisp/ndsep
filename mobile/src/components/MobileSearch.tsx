import React, { useState, useMemo } from "react";
import { View, TextInput, FlatList, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { colors, spacing, fontSize, borderRadius, fontWeight } from "../theme";

interface SearchItem {
  title: string;
  subtitle: string;
  screen: string;
  params?: Record<string, any>;
  icon: string;
}

const searchableItems: SearchItem[] = [
  { title: "Dashboard", subtitle: "Overview & statistics", screen: "DashboardHome", icon: "home" },
  { title: "Compliance Audit", subtitle: "Audit returns & scores", screen: "ComplianceAudit", icon: "check-circle" },
  { title: "AI Governance", subtitle: "Algorithm registry & risk", screen: "AIGovernance", icon: "cpu" },
  { title: "DPIA", subtitle: "Impact assessments", screen: "DPIA", icon: "file-text" },
  { title: "DSAR", subtitle: "Data subject requests", screen: "DSAR", icon: "users" },
  { title: "Data Transfers", subtitle: "Cross-border transfers", screen: "DataTransfers", icon: "globe" },
  { title: "Banking Oversight", subtitle: "NIP/RTGS & AML", screen: "Banking", icon: "credit-card" },
  { title: "Workflows", subtitle: "Automation & tasks", screen: "Workflows", icon: "git-branch" },
  { title: "Enforcement", subtitle: "Cases & penalties", screen: "EnforcementList", icon: "shield" },
  { title: "Penalty Calculator", subtitle: "NDPA Art. 47 fines", screen: "PenaltyCalculator", icon: "dollar-sign" },
  { title: "Breach List", subtitle: "Reported breaches", screen: "BreachList", icon: "alert-triangle" },
  { title: "Report Breach", subtitle: "File new breach report", screen: "BreachReport", icon: "alert-octagon" },
  { title: "NOC Monitor", subtitle: "Network operations", screen: "NOCMonitor", icon: "activity" },
  { title: "Network Intelligence", subtitle: "Threat detection", screen: "NetworkIntelligence", icon: "wifi" },
  { title: "Profile", subtitle: "Your account settings", screen: "Profile", icon: "user" },
  { title: "Notifications", subtitle: "Alert preferences", screen: "Notifications", icon: "bell" },
  { title: "Security", subtitle: "2FA & sessions", screen: "Security", icon: "lock" },
  { title: "Offline Data", subtitle: "Cached data management", screen: "OfflineData", icon: "download-cloud" },
];

interface MobileSearchProps {
  onClose?: () => void;
}

export function MobileSearch({ onClose }: MobileSearchProps) {
  const [query, setQuery] = useState("");
  const navigation = useNavigation<any>();

  const filtered = useMemo(() => {
    if (!query.trim()) return searchableItems.slice(0, 6);
    const q = query.toLowerCase();
    return searchableItems.filter(
      (item) => item.title.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q)
    );
  }, [query]);

  const handleSelect = (item: SearchItem) => {
    navigation.navigate(item.screen, item.params);
    onClose?.();
  };

  return (
    <View style={s.container}>
      <View style={s.searchRow}>
        <Feather name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search screens, features..."
          placeholderTextColor={colors.textMuted}
          autoFocus
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery("")}>
            <Feather name="x" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.screen}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.resultRow} onPress={() => handleSelect(item)} activeOpacity={0.7}>
            <View style={s.iconWrap}>
              <Feather name={item.icon as any} size={16} color={colors.primary} />
            </View>
            <View style={s.resultText}>
              <Text style={s.resultTitle}>{item.title}</Text>
              <Text style={s.resultSub}>{item.subtitle}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="search" size={32} color={colors.textMuted} />
            <Text style={s.emptyText}>No results for "{query}"</Text>
          </View>
        }
        style={s.list}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    margin: spacing.lg,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.base,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: `${colors.primary}15`,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  resultText: { flex: 1 },
  resultTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.medium as any },
  resultSub: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  empty: { alignItems: "center", paddingVertical: spacing.xxxl },
  emptyText: { color: colors.textMuted, fontSize: fontSize.base, marginTop: spacing.md },
});
