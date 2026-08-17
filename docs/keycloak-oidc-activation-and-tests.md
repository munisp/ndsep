# IDLR-PTS Keycloak OIDC Activation and Lifecycle Tests

## Activation inputs

The mobile client is a **public native client**. It must not hold a client secret. Configure `EXPO_PUBLIC_OIDC_ISSUER`, `EXPO_PUBLIC_OIDC_CLIENT_ID`, and `EXPO_PUBLIC_OIDC_REDIRECT_URI` only in the native build environment. The backend separately verifies issuer, audience, expiry, signing key, nonce, and agency-role claims; it never trusts mobile-provided roles.

| Value | Native build setting | Keycloak client setting |
|---|---|---|
| Issuer | `EXPO_PUBLIC_OIDC_ISSUER=https://sso.example.ng/realms/idlrpts` | Realm issuer |
| Client ID | `EXPO_PUBLIC_OIDC_CLIENT_ID=idlrpts-mobile` | `idlrpts-mobile` public client |
| Redirect URI | `EXPO_PUBLIC_OIDC_REDIRECT_URI=idlrpts://oauth/callback` | Exact redirect URI |
| PKCE | Built into the mobile request | `S256` required |
| Refresh tokens | Request `offline_access` only if approved | Rotation/reuse detection enabled |

## Staging integration suite

Run these against a disposable Keycloak realm and a real native development build; browser/PWA tests cannot prove SecureStore or Face ID behavior.

1. **Authorization code with PKCE.** Assert a valid code exchanges once, an altered verifier fails, and the issuer/audience match the configured realm/client.
2. **Refresh rotation.** Refresh the session, verify the new refresh token is stored behind biometric protection, then attempt reuse of the former token and expect `invalid_grant` plus local session removal.
3. **Revocation.** Revoke the refresh token at the provider, call local sign-out, and verify SecureStore session removal plus backend rejection of the old access token after expiry.
4. **Biometric invalidation.** Change device biometric enrollment, assert SecureStore read failure is handled by clearing local session and returning to `/login`; no token fallback is permitted.
5. **Claims and role boundary.** Exchange an applicant token and assert that reviewer-only API calls fail; exchange a planning-supervisor token and assert agency/role checks—not app navigation—control the server outcome.
6. **Registration boundary.** Start sign-up with `kc_action=REGISTER`; assert account creation alone does not mark KYB, CAC, NIN, or liveness states as verified.

## Deployment checks

The native build must include the `expo-local-authentication` plugin. On iOS, Face ID requires a development or production build; Expo Go cannot provide a valid Face ID verification result. A production activation gate must capture the OIDC discovery document, PKCE test evidence, client redirect URI proof, Keycloak signing-key rotation policy, realm admin separation, and refresh-token reuse detection evidence.
