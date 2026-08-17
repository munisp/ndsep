import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "@/server/routers";

export type FieldErrors = Record<string, string>;

export function mapStakeholderMutationError(error: TRPCClientErrorLike<AppRouter>): { title: string; message: string; fields: FieldErrors; retryable: boolean } {
  const fields = (((error.data as unknown as { zodError?: { fieldErrors?: FieldErrors } } | undefined)?.zodError?.fieldErrors) ?? {}) as FieldErrors;
  switch (error.data?.code) {
    case "BAD_REQUEST":
      return { title: "Check the highlighted fields", message: "Correct the profile values and submit again.", fields, retryable: false };
    case "UNAUTHORIZED":
      return { title: "Sign in required", message: "Your session has expired. Sign in and try again.", fields: {}, retryable: true };
    case "FORBIDDEN":
      return { title: "Not permitted", message: "Your current agency role cannot complete this action.", fields: {}, retryable: false };
    case "CONFLICT":
      return { title: "Profile changed elsewhere", message: "Refresh the latest record before making a decision.", fields: {}, retryable: true };
    case "PRECONDITION_FAILED":
      return { title: "Evidence required", message: "An authorised provider result or reviewer evidence is required before this decision.", fields: {}, retryable: false };
    default:
      return { title: "Could not save profile", message: "No verification outcome was changed. Retry when connectivity is restored or contact an administrator.", fields: {}, retryable: true };
  }
}
