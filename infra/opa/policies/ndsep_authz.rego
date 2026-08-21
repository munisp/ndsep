package ndsep.authz

# OPA is a second decision point for privileged NDSEP actions. It deliberately
# defaults to deny; a request must already be authenticated and satisfy the
# local PBAC/Permify checks before it reaches this policy.
default allow := false

privileged_actions := {"admin", "approve", "delete", "export"}

# Non-production environments retain local PBAC enforcement when OPA is not
# provisioned. Production is always evaluated through this policy client.
allow if {
  input.context.environment != "production"
  input.subject.authenticated
}

# Every production privileged action requires a verified MFA signal originating
# from the signed Keycloak token, not a browser-provided header.
allow if {
  input.context.environment == "production"
  input.subject.authenticated
  input.context.mfaVerified
  input.action in privileged_actions
  allowed_role_for_action
}

allowed_role_for_action if {
  input.action == "admin"
  input.subject.role == "admin"
}

allowed_role_for_action if {
  input.action == "delete"
  input.subject.role == "admin"
}

allowed_role_for_action if {
  input.action == "export"
  input.subject.role == "admin"
}

allowed_role_for_action if {
  input.action == "approve"
  input.subject.role in {"admin", "government_staff", "regulator", "legal_officer", "data_protection_officer"}
}
