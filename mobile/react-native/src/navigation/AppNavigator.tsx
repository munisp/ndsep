/**
 * NDSEP Mobile — Root Navigation
 * Feature parity with the web PWA sidebar navigation.
 * All 28 screens wired into drawer (grouped sections) + bottom tabs.
 */
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";

// Screens — Core
import DashboardScreen from "../screens/DashboardScreen";
import ComplianceScreen from "../screens/ComplianceScreen";
import EnforcementScreen from "../screens/EnforcementScreen";
import OrganizationsScreen from "../screens/OrganizationsScreen";
import SecurityAlertsScreen from "../screens/SecurityAlertsScreen";
import AssetRegistryScreen from "../screens/AssetRegistryScreen";
import CitizenRightsScreen from "../screens/CitizenRightsScreen";
import PortalScreen from "../screens/PortalScreen";
import AuditLogScreen from "../screens/AuditLogScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import LoginScreen from "../screens/LoginScreen";
import OrganizationDetailScreen from "../screens/OrganizationDetailScreen";
import PenaltyDetailScreen from "../screens/PenaltyDetailScreen";

// Screens — Compliance & Governance
import BreachIncidentsScreen from "../screens/BreachIncidentsScreen";
import ConsentManagementScreen from "../screens/ConsentManagementScreen";
import CookieConsentScreen from "../screens/CookieConsentScreen";
import DpiaScreen from "../screens/DpiaScreen";
import DpoRegistryScreen from "../screens/DpoRegistryScreen";
import ComplianceLeaderboardScreen from "../screens/ComplianceLeaderboardScreen";
import VendorRiskScreen from "../screens/VendorRiskScreen";
import TiaAssessmentsScreen from "../screens/TiaAssessmentsScreen";

// Screens — Enforcement & Finance
import FinancialEnforcementScreen from "../screens/FinancialEnforcementScreen";
import RemediationWorkflowsScreen from "../screens/RemediationWorkflowsScreen";

// Screens — Operations & Intelligence
import BankingDashboardScreen from "../screens/BankingDashboardScreen";
import MiddlewareHealthScreen from "../screens/MiddlewareHealthScreen";
import RegulatoryReportsScreen from "../screens/RegulatoryReportsScreen";
import AiAdvisorScreen from "../screens/AiAdvisorScreen";
import DpcoPortalScreen from "../screens/DpcoPortalScreen";

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

/** Bottom tab navigator for the 5 most-used sections */
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: "#0a0e1a", borderTopColor: "#1e293b" },
        tabBarActiveTintColor: "#00d4ff",
        tabBarInactiveTintColor: "#64748b",
        headerShown: false,
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Compliance" component={ComplianceScreen} />
      <Tab.Screen name="Enforcement" component={EnforcementScreen} />
      <Tab.Screen name="Alerts" component={SecurityAlertsScreen} />
      <Tab.Screen name="Reports" component={RegulatoryReportsScreen} />
    </Tab.Navigator>
  );
}

/** Full drawer navigator with all platform sections */
function DrawerNav() {
  return (
    <Drawer.Navigator
      screenOptions={{
        drawerStyle: { backgroundColor: "#0a0e1a", width: 300 },
        drawerActiveTintColor: "#00d4ff",
        drawerInactiveTintColor: "#94a3b8",
        headerStyle: { backgroundColor: "#0a0e1a" },
        headerTintColor: "#f1f5f9",
        drawerType: "front",
      }}
    >
      {/* Core */}
      <Drawer.Screen name="Home" component={MainTabs} options={{ title: "Dashboard", drawerItemStyle: { marginTop: 8 } }} />
      <Drawer.Screen name="Organizations" component={OrganizationsScreen} />
      <Drawer.Screen name="Notifications" component={NotificationsScreen} />

      {/* Compliance & Governance */}
      <Drawer.Screen name="BreachIncidents" component={BreachIncidentsScreen} options={{ title: "Breach Incidents" }} />
      <Drawer.Screen name="ConsentManagement" component={ConsentManagementScreen} options={{ title: "Consent Management" }} />
      <Drawer.Screen name="CookieConsent" component={CookieConsentScreen} options={{ title: "Cookie Consent" }} />
      <Drawer.Screen name="DPIA" component={DpiaScreen} options={{ title: "DPIA" }} />
      <Drawer.Screen name="DpoRegistry" component={DpoRegistryScreen} options={{ title: "DPO Registry" }} />
      <Drawer.Screen name="CitizenRights" component={CitizenRightsScreen} options={{ title: "Citizen Rights (DSAR)" }} />
      <Drawer.Screen name="VendorRisk" component={VendorRiskScreen} options={{ title: "Vendor Risk" }} />
      <Drawer.Screen name="TiaAssessments" component={TiaAssessmentsScreen} options={{ title: "TIA Assessments" }} />
      <Drawer.Screen name="Leaderboard" component={ComplianceLeaderboardScreen} options={{ title: "Compliance Leaderboard" }} />

      {/* Enforcement & Finance */}
      <Drawer.Screen name="FinancialEnforcement" component={FinancialEnforcementScreen} options={{ title: "Financial Enforcement" }} />
      <Drawer.Screen name="Remediation" component={RemediationWorkflowsScreen} options={{ title: "Remediation Workflows" }} />

      {/* Operations & Intelligence */}
      <Drawer.Screen name="AssetRegistry" component={AssetRegistryScreen} options={{ title: "Asset Registry" }} />
      <Drawer.Screen name="Banking" component={BankingDashboardScreen} options={{ title: "Banking & KYC" }} />
      <Drawer.Screen name="AiAdvisor" component={AiAdvisorScreen} options={{ title: "AI Advisor" }} />
      <Drawer.Screen name="DpcoPortal" component={DpcoPortalScreen} options={{ title: "DPCO Portal" }} />
      <Drawer.Screen name="MiddlewareHealth" component={MiddlewareHealthScreen} options={{ title: "Middleware Health" }} />
      <Drawer.Screen name="Portal" component={PortalScreen} options={{ title: "Org Portal" }} />
      <Drawer.Screen name="AuditLog" component={AuditLogScreen} options={{ title: "Audit Log" }} />
    </Drawer.Navigator>
  );
}

/** Root stack — handles auth gate and detail screens */
export default function AppNavigator({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={DrawerNav} />
            <Stack.Screen name="OrganizationDetail" component={OrganizationDetailScreen} />
            <Stack.Screen name="PenaltyDetail" component={PenaltyDetailScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
