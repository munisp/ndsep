const required = ["CORS_ALLOWED_ORIGINS", "DATABASE_URL", "PAYMENT_AUDIT_POSTGRES_URL", "EXPO_PUBLIC_OIDC_ISSUER", "EXPO_PUBLIC_OIDC_CLIENT_ID", "DIAGNOSTIC_ATTESTATION_KEY_ID", "DIAGNOSTIC_ATTESTATION_ED25519_PRIVATE_KEY", "METRICS_BEARER_TOKEN", "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY", "OBJECT_STORAGE_PUBLIC_BASE_URL"];
const invalid = (value) => !value || /<|>|example|simulation|change-before-use|idlr_tests/i.test(value);
const missing = required.filter((key) => invalid(process.env[key]));
const invalidHttps = ["CORS_ALLOWED_ORIGINS", "EXPO_PUBLIC_OIDC_ISSUER", "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_PUBLIC_BASE_URL"].filter((key) => !missing.includes(key) && process.env[key].split(",").some((value) => !value.trim().startsWith("https://")));
if (missing.length || invalidHttps.length) { console.error(JSON.stringify({ ok: false, missingOrPlaceholder: missing, invalidHttps })); process.exit(1); }
console.log(JSON.stringify({ ok: true, verified: required }));
