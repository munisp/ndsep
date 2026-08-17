# Stakeholder Onboarding: KYB Screening, Manual Review, and Trust Status

## What the rendered flow does

The **Stakeholder Onboarding** route combines a business-profile form, identity and KYB-document intake, a scoped liveness capture step, a readiness checklist, and provider-health disclosure. It is intentionally designed so a saved profile, document extraction result, or locally seeded workflow status is **not** presented as an official identity, CAC, NIN, title, or liveness verification result.

| Stage | User action | System action | Trust boundary |
|---|---|---|---|
| Business profile | Enter company name, CAC/RC number, TIN, contact, address, and communication details | Calls `submitBusinessProfile` through the mobile bundle | The record is saved; CAC verification is not asserted unless the authorised CAC bridge is ready. |
| KYB document intake | Select an image for a Certificate of Incorporation or other business evidence | Reads the selected file as Base64 and calls `analyzeBusinessDocument` | Analysis output is labelled with status, engine, confidence, and provenance; it routes review rather than authenticating a document. |
| Manual-review routing | Reviewers use document status, reason, engine, and confidence as triage information | The screen displays `manual_review` provenance and `analysisReason` when supplied | Only authorised reviewers and configured authority providers can create a verified external trust outcome. |
| Liveness review | Capture one front-camera still image | Starts a liveness session and uploads one captured frame | One image cannot prove a blink-turn-smile challenge. The implementation states this explicitly and routes the case to authorised review. |
| Readiness | View the checklist and next action | The mobile bundle supplies readiness percentage, checklist completion flags, and next action | Readiness is workflow progress—not a global statement that a person or company is officially verified. |

## KYB document screening and review routing

The document picker is constrained to images and copies the selected asset to the cache directory. `pickDocument("business", "Certificate of Incorporation")` converts the selected file to Base64 and sends it to `analyzeBusinessDocument`. The interface then renders returned documents with four evidence fields: **status**, **engine**, **confidence**, and **analysis provenance**. When an analysis reason is available, it is shown as a warning.

> Document intelligence is **assistive screening and evidence extraction**. It does not establish registry authority, identity authenticity, or CAC verification by itself.

The screen separately queries `trust.providerHealth`. When Docling is unavailable, the UI explains that files can use only the separately labelled assistive flow where configured. When the CAC bridge is unavailable, it allows profile saving but explicitly says no registration claim is verified.

## Readiness checklist and trust-status updates

The readiness card is derived from `bundle.onboarding.readiness`, `bundle.onboarding.nextAction`, and `bundle.onboarding.checklist`. Each checklist item is shown as **Completed** or **Pending**. These flags are workflow-state inputs supplied by the mobile bundle; they should be interpreted together with provider availability and document provenance.

Trust status should update only through these distinct paths:

1. **Profile update:** saving form fields updates the KYB profile record but does not verify CAC/TIN claims.
2. **Screening update:** a document-analysis result can update the document’s screening status and review evidence. It must retain its engine, confidence, provenance, and reason.
3. **Authorised provider update:** a configured authority bridge or liveness provider may return an external outcome. If it is unavailable, the UI remains unavailable or pending.
4. **Authorised review update:** a qualified reviewer may reach a workflow decision under the platform’s role and audit controls. The UI must not substitute a confidence score for that decision.

## Implementation excerpt

```tsx
async function pickDocument(kind: "identity" | "business", type: string) {
  const result = await DocumentPicker.getDocumentAsync({
    type: "image/*",
    copyToCacheDirectory: true,
  });
  if (result.canceled) return;

  const asset = result.assets[0];
  const base64Data = await readAssetAsBase64(asset.uri);

  if (kind === "business") {
    await analyzeBusinessDocument.mutateAsync({
      type,
      fileName: asset.name,
      mimeType: asset.mimeType ?? "image/jpeg",
      base64Data,
    });
  }
}
```

```tsx
{bundle.onboarding.businessProfile.documents.map((document) => (
  <View key={document.id}>
    <Text>{document.type}</Text>
    <Text>
      Status: {document.status} · Engine: {document.engine ?? "manual"}
      · {document.analysisProvenance ?? "manual_review"}
    </Text>
    <Text>Confidence: {document.confidence ?? 0}%</Text>
    {document.analysisReason ? <Text>{document.analysisReason}</Text> : null}
  </View>
))}
```

The full rendered screen implementation is in `app/onboarding.tsx`.
