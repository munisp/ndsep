/**
 * NDSEP Mobile Navigation
 * Full feature parity with web — all major screens accessible.
 */
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { colors } from "../theme";

// Screens
import { DashboardScreen } from "../screens/DashboardScreen";
import { ComplianceDetailScreen } from "../screens/ComplianceDetailScreen";
import { OrganizationDetailScreen } from "../screens/OrganizationDetailScreen";
import { EnforcementListScreen } from "../screens/EnforcementListScreen";
import { CaseDetailScreen } from "../screens/CaseDetailScreen";
import { PenaltyCalculatorScreen } from "../screens/PenaltyCalculatorScreen";
import { BreachListScreen } from "../screens/BreachListScreen";
import { BreachReportScreen } from "../screens/BreachReportScreen";
import { BreachTimelineScreen } from "../screens/BreachTimelineScreen";
import { NOCMonitorScreen } from "../screens/NOCMonitorScreen";
import { AlertDetailScreen } from "../screens/AlertDetailScreen";
import { NetworkIntelligenceScreen } from "../screens/NetworkIntelligenceScreen";
import { SettingsHomeScreen } from "../screens/SettingsHomeScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { SecurityScreen } from "../screens/SecurityScreen";
import { OfflineDataScreen } from "../screens/OfflineDataScreen";
import { DSARScreen } from "../screens/DSARScreen";
import { DataTransfersScreen } from "../screens/DataTransfersScreen";
import { ComplianceAuditScreen } from "../screens/ComplianceAuditScreen";
import { AIGovernanceScreen } from "../screens/AIGovernanceScreen";
import { BankingScreen } from "../screens/BankingScreen";
import { DPIAScreen } from "../screens/DPIAScreen";
import { WorkflowsScreen } from "../screens/WorkflowsScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const stackOpts = {
  headerStyle: { backgroundColor: colors.card },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: "600" as const },
};

function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="DashboardHome" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Stack.Screen name="ComplianceDetail" component={ComplianceDetailScreen} options={{ title: "Compliance" }} />
      <Stack.Screen name="OrganizationDetail" component={OrganizationDetailScreen} options={{ title: "Organization" }} />
      <Stack.Screen name="ComplianceAudit" component={ComplianceAuditScreen} options={{ title: "Audits" }} />
      <Stack.Screen name="AIGovernance" component={AIGovernanceScreen} options={{ title: "AI Governance" }} />
      <Stack.Screen name="DPIA" component={DPIAScreen} options={{ title: "DPIA" }} />
      <Stack.Screen name="DSAR" component={DSARScreen} options={{ title: "DSAR" }} />
      <Stack.Screen name="DataTransfers" component={DataTransfersScreen} options={{ title: "Transfers" }} />
      <Stack.Screen name="Banking" component={BankingScreen} options={{ title: "Banking" }} />
      <Stack.Screen name="Workflows" component={WorkflowsScreen} options={{ title: "Workflows" }} />
    </Stack.Navigator>
  );
}

function EnforcementStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="EnforcementList" component={EnforcementListScreen} options={{ title: "Enforcement" }} />
      <Stack.Screen name="CaseDetail" component={CaseDetailScreen} options={{ title: "Case Details" }} />
      <Stack.Screen name="PenaltyCalculator" component={PenaltyCalculatorScreen} options={{ title: "Penalty Calculator" }} />
    </Stack.Navigator>
  );
}

function BreachStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="BreachList" component={BreachListScreen} options={{ title: "Breaches" }} />
      <Stack.Screen name="BreachReport" component={BreachReportScreen} options={{ title: "Report Breach" }} />
      <Stack.Screen name="BreachTimeline" component={BreachTimelineScreen} options={{ title: "Timeline" }} />
    </Stack.Navigator>
  );
}

function NOCStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="NOCMonitor" component={NOCMonitorScreen} options={{ title: "NOC Monitor" }} />
      <Stack.Screen name="AlertDetail" component={AlertDetailScreen} options={{ title: "Alert" }} />
      <Stack.Screen name="NetworkIntelligence" component={NetworkIntelligenceScreen} options={{ title: "Network Intel" }} />
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="SettingsHome" component={SettingsHomeScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="Security" component={SecurityScreen} options={{ title: "Security" }} />
      <Stack.Screen name="OfflineData" component={OfflineDataScreen} options={{ title: "Offline Data" }} />
    </Stack.Navigator>
  );
}

const linking = {
  prefixes: ["ndsep://", "https://ndsep.gov.ng"],
  config: {
    screens: {
      Dashboard: {
        screens: {
          DashboardHome: "dashboard",
          ComplianceDetail: "compliance/:id",
          OrganizationDetail: "org/:id",
          ComplianceAudit: "audits",
          AIGovernance: "ai-governance",
          DPIA: "dpia",
          DSAR: "dsar",
          DataTransfers: "transfers",
          Banking: "banking",
          Workflows: "workflows",
        },
      },
      Enforcement: {
        screens: {
          EnforcementList: "enforcement",
          CaseDetail: "enforcement/:id",
          PenaltyCalculator: "penalty-calculator",
        },
      },
      Breaches: {
        screens: {
          BreachList: "breaches",
          BreachReport: "breach/report",
          BreachTimeline: "breach/:id/timeline",
        },
      },
      NOC: {
        screens: {
          NOCMonitor: "noc",
          AlertDetail: "alert/:id",
          NetworkIntelligence: "network-intel",
        },
      },
      Settings: {
        screens: {
          SettingsHome: "settings",
          Profile: "profile",
          Notifications: "notifications",
          Security: "security",
          OfflineData: "offline",
        },
      },
    },
  },
};

export function AppNavigator() {
  return (
    <NavigationContainer linking={linking}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color, size }) => {
            const icons: Record<string, string> = {
              Dashboard: "home",
              Enforcement: "shield",
              Breaches: "alert-triangle",
              NOC: "activity",
              Settings: "settings",
            };
            return <Feather name={icons[route.name] as any} size={size} color={color} />;
          },
          tabBarActiveTintColor: colors.tabBarActive,
          tabBarInactiveTintColor: colors.tabBarInactive,
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.cardBorder },
          headerShown: false,
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardStack} />
        <Tab.Screen name="Enforcement" component={EnforcementStack} />
        <Tab.Screen name="Breaches" component={BreachStack} />
        <Tab.Screen name="NOC" component={NOCStack} />
        <Tab.Screen name="Settings" component={SettingsStack} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
