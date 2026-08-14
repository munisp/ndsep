# Payment Gateway Verification Sources

The payment settlement boundary is designed around the following provider guidance, reviewed on 2026-08-13.

## Paystack

Paystack describes webhooks as the preferred confirmation channel for successful transactions, but directs server-side verification through `GET /transaction/verify/:reference` using the secret key. The integration must check the transaction status in the response `data` object, not the outer API response status. The verification response exposes the transaction reference, amount in kobo, currency, transaction ID, and paid timestamp.

Source: [Paystack Verify Payments](https://paystack.com/docs/payments/verify-payments/)

## Flutterwave

Flutterwave directs merchants to verify a completed transaction before giving value. The verification endpoint is `GET /v3/transactions/{id}/verify` with a server secret key. The integration must confirm successful status, generated transaction reference, expected currency, and expected amount before recording payment evidence.

Source: [Flutterwave Transaction Verification](https://developer.flutterwave.com/v3.0/docs/transaction-verification)

## Local policy

This project does not mark an offline payment as gateway-settled from a webhook payload alone. A signed webhook can create an auditable delivery record, but `settlement_status` can become `verified` only after the configured provider’s authenticated verification response matches the stored reference, exact NGN amount, and successful status. Without approved credentials and a public HTTPS callback origin, the webhook endpoint remains unavailable.
