package main

import (
	"testing"
)

func TestValidateIAMConfigurationRequiresEnabledDependencies(t *testing.T) {
	originalURL, originalRealm, originalClientID, originalSecret := keycloakURL, keycloakRealm, keycloakClientID, keycloakSecret
	originalPermifyURL, originalTenant := permifyURL, permifyTenant
	originalKeycloakEnabled, originalPermifyEnabled := keycloakEnabled, permifyEnabled
	defer func() {
		keycloakURL, keycloakRealm, keycloakClientID, keycloakSecret = originalURL, originalRealm, originalClientID, originalSecret
		permifyURL, permifyTenant = originalPermifyURL, originalTenant
		keycloakEnabled, permifyEnabled = originalKeycloakEnabled, originalPermifyEnabled
	}()

	keycloakEnabled, permifyEnabled = true, true
	keycloakURL, keycloakRealm, keycloakClientID, keycloakSecret = "", "ndsep", "iam", "secret"
	permifyURL, permifyTenant = "http://permify.internal:3476", "ndsep"
	if err := validateIAMConfiguration(); err == nil {
		t.Fatal("expected enabled Keycloak without URL to be rejected")
	}

	keycloakURL = "https://keycloak.internal"
	permifyURL = ""
	if err := validateIAMConfiguration(); err == nil {
		t.Fatal("expected enabled Permify without URL to be rejected")
	}

	permifyURL = "http://permify.internal:3476"
	if err := validateIAMConfiguration(); err != nil {
		t.Fatalf("expected complete non-production IAM configuration to validate: %v", err)
	}
}

func TestCheckPermissionDeniesWhenPermifyIsUnavailable(t *testing.T) {
	mu.Lock()
	originalOK := permifyOK
	permifyOK = false
	mu.Unlock()
	defer func() {
		mu.Lock()
		permifyOK = originalOK
		mu.Unlock()
	}()

	allowed, err := checkPermission("user", "u-1", "read", "report", "r-1")
	if err == nil || allowed {
		t.Fatalf("expected unavailable Permify to deny with an error, got allowed=%v err=%v", allowed, err)
	}
}
