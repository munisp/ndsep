import { ScrollView, Text, View, Pressable } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useMobilePlatformBundle } from "@/lib/mobile-sync";
import type { LegalWorkflowRecord, LegalWorkflowStatus } from "@/lib/mobile-data";

const nextStatusMap: Partial<Record<LegalWorkflowStatus, LegalWorkflowStatus>> = {
  draft: "pending_review",
  pending_review: "approved",
  approved: "signed",
  signed: "registered",
};

function WorkflowCard({
  workflow,
  onAdvance,
}: {
  workflow: LegalWorkflowRecord;
  onAdvance: (workflow: LegalWorkflowRecord) => Promise<void>;
}) {
  const nextStatus = nextStatusMap[workflow.status];

  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1">
          <Text className="text-lg font-semibold text-foreground">{workflow.type}</Text>
          <Text className="mt-1 text-sm text-muted">Parcel ID {workflow.parcelId} · Transaction {workflow.transactionId}</Text>
        </View>
        <View className="rounded-full border border-border bg-background px-3 py-1">
          <Text className="text-xs font-semibold text-foreground">{workflow.status}</Text>
        </View>
      </View>

      <Text className="mt-4 text-sm text-muted">Assigned desk: {workflow.assignedDesk}</Text>
      <Text className="mt-1 text-sm text-muted">Prepared by: {workflow.preparedBy}</Text>
      <Text className="mt-1 text-sm text-muted">Reviewed by: {workflow.reviewedBy ?? "Pending reviewer assignment"}</Text>
      <Text className="mt-1 text-sm text-muted">Registration: {workflow.registrationNumber ?? "Not yet issued"}</Text>

      <View className="mt-4 gap-3">
        {workflow.timeline.map((entry) => (
          <View key={entry.key} className="rounded-2xl border border-border bg-background p-4">
            <Text className="font-semibold text-foreground">{entry.label}</Text>
            <Text className="mt-1 text-sm text-muted">{entry.completed ? `Completed${entry.timestamp ? ` · ${new Date(entry.timestamp).toLocaleString()}` : ""}` : "Pending"}</Text>
          </View>
        ))}
      </View>

      {nextStatus ? (
        <Pressable onPress={() => void onAdvance(workflow)}>
          <View className="mt-4 rounded-2xl bg-foreground px-4 py-4">
            <Text className="text-center font-semibold text-background">Advance to {nextStatus.replaceAll("_", " ")}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function LegalWorkflowScreen() {
  const { bundle, advanceLegalWorkflow } = useMobilePlatformBundle();

  async function handleAdvance(workflow: LegalWorkflowRecord) {
    const nextStatus = nextStatusMap[workflow.status];
    if (!nextStatus) return;

    await advanceLegalWorkflow.mutateAsync({
      workflowId: workflow.id,
      status: nextStatus,
      reviewedBy: workflow.reviewedBy ?? "Mobile Registry Supervisor",
    });
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <View>
          <Text className="text-3xl font-bold text-foreground">Legal workflow</Text>
          <Text className="mt-2 text-sm leading-5 text-muted">
            Progress Certificate of Occupancy and related land-rights workflows through review, approval, signing, and registration from the native app.
          </Text>
        </View>

        <View className="rounded-3xl bg-primary p-5">
          <Text className="text-sm text-white/80">Workflow coverage</Text>
          <Text className="mt-2 text-3xl font-bold text-white">{bundle.legalWorkflows.length}</Text>
          <Text className="mt-2 text-sm text-white/85">
            {bundle.legalWorkflows.filter((workflow) => workflow.status === "registered").length} workflows are already registered. Pending cases can be advanced directly from this screen.
          </Text>
        </View>

        <View className="gap-4">
          {bundle.legalWorkflows.map((workflow) => (
            <WorkflowCard key={workflow.id} workflow={workflow} onAdvance={handleAdvance} />
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
