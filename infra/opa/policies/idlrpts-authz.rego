package idlrpts.authz

default allow := false

privileged_paths := {
  "/api/trpc/integrationSettings.save",
  "/api/trpc/diagnosticExports.bulkRevoke",
  "/api/trpc/diagnosticExports.revoke",
}

has_role(role) if {
  role == input.subject.roles[_]
}

is_privileged if {
  input.path in privileged_paths
}

allow if {
  not is_privileged
  input.subject.sub != ""
}

allow if {
  is_privileged
  has_role("admin")
  input.subject.acr == "urn:idlrpts:mfa"
}

reason := "mfa_admin_required_for_privileged_actions" if {
  is_privileged
}

reason := "authenticated_subject_required" if {
  not is_privileged
}

decision := {
  "allow": allow,
  "reason": reason,
}
