export function bulkSessionConfirmationPhrase(count: number) {
  return `TERMINATE ${count}`;
}

export function validateBulkSessionRevocation(input: { sessionIds: string[]; confirmation: string; reason: string }) {
  const unique = [...new Set(input.sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))];
  if (!unique.length || unique.length > 20) return { valid: false as const, reason: "Select between 1 and 20 sessions." };
  if (input.confirmation.trim() !== bulkSessionConfirmationPhrase(unique.length)) return { valid: false as const, reason: `Enter ${bulkSessionConfirmationPhrase(unique.length)} to confirm.` };
  if (input.reason.trim().length < 10) return { valid: false as const, reason: "Provide a reason of at least 10 characters." };
  return { valid: true as const, sessionIds: unique, reason: input.reason.trim().slice(0, 240) };
}
