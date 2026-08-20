package idlrpts.authz

test_privileged_requires_mfa if {
  not allow with input as {"path": "/api/trpc/integrationSettings.save", "subject": {"sub": "admin-1", "roles": ["admin"], "acr": "urn:idlrpts:password"}}
}

test_privileged_admin_with_mfa_allowed if {
  allow with input as {"path": "/api/trpc/integrationSettings.save", "subject": {"sub": "admin-1", "roles": ["admin"], "acr": "urn:idlrpts:mfa"}}
}
