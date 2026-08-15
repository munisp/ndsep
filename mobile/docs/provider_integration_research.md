# Provider Integration Research Notes

## Nigerian authoritative verification access

The National Identity Management Commission states that its NIMC Verification Service API verifies identities in the National Identity Database through a SOAP service. It supports NIN, demographic, and fingerprint-related verification modes, requires secure VPN access, and requires an approved written request before sandbox credentials are issued.[1]

The CAC VAS service advertises business registration and validation APIs, including lookup by RC number and business-validation products. The NIBSS/CAC announcement explains that CAC database access is provided to selected private-sector super agents and must be handled in line with data-protection requirements.[2] [3]

## Liveness provider evidence

Smile ID documents an asynchronous pattern: submit a verification request, receive a job ID, and consume the final status, message, and reason through a callback URL.[4] Dojah documents a direct liveness endpoint that accepts a Base64 selfie with an App ID and secret-key authorization, returning a liveness pass/fail value, probability, and face-detection details.[5]

## Document intelligence evidence

Docling Serve is an HTTP API service that can be self-hosted. Its documented `POST /v1/convert/source` endpoint accepts `file_sources` with `base64_string` and `filename`, and supports OCR options. The service can be protected with `X-Api-Key`.[6] [7] PaddleOCR provides OCR/document-parsing models and deployment tooling, but it must be deployed and operated separately before the platform can claim those services are available.[8]

## Implementation consequence

The application implements only configuration-backed calls to these classes of providers. Without approved provider accounts, service URLs, credentials, callback configuration, and an authorization boundary, the application must return an explicit unavailable state rather than a plausible verification result.

## References

[1]: https://nimc.gov.ng/nimc-verification-service-api "NIMC Verification Service API"
[2]: https://vas.cac.gov.ng/ "CAC VAS API Integrated Service"
[3]: https://nibss-plc.com.ng/nibss-and-cac-launch-api-integration-platform-to-streamline-business-services-and-enhance-data-verification/ "NIBSS and CAC API Integration Platform"
[4]: https://docs.usesmileid.com/ "Smile ID Overview"
[5]: https://docs.dojah.io/docs/biometrics/liveness-check "Dojah Liveness Check API"
[6]: https://docling-project.github.io/docling/usage/api_server/ "Docling API Server"
[7]: https://github.com/docling-project/docling-serve "Docling Serve"
[8]: https://paddlepaddle.github.io/PaddleOCR/main/en/index.html "PaddleOCR Documentation"
