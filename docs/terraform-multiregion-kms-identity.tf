terraform {
  required_version = ">= 1.7.0"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
}
variable "primary_region" { type = string; default = "eu-west-1" }
variable "secondary_region" { type = string; default = "eu-central-1" }
variable "cluster_oidc_issuer" { type = string }
variable "namespace" { type = string; default = "idlr-staging" }
variable "recovery_service_account" { type = string; default = "recovery-worker" }
variable "audit_service_account" { type = string; default = "audit-signer" }

provider "aws" { region = var.primary_region }
provider "aws" { alias = "secondary"; region = var.secondary_region }
data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "eks" {
  url = var.cluster_oidc_issuer
  client_id_list = ["sts.amazonaws.com"]
  # Pin the issuer certificate thumbprint obtained by your approved PKI process.
  thumbprint_list = ["REPLACE_WITH_APPROVED_OIDC_THUMBPRINT"]
}

resource "aws_kms_key" "recovery_primary" {
  description = "IDLR staging recovery envelope key"
  multi_region = true
  enable_key_rotation = true
  deletion_window_in_days = 30
}
resource "aws_kms_replica_key" "recovery_secondary" {
  provider = aws.secondary
  primary_key_arn = aws_kms_key.recovery_primary.arn
  description = "IDLR staging recovery envelope key replica"
  deletion_window_in_days = 30
}
resource "aws_kms_key" "audit_primary" { description = "IDLR staging audit signing key"; multi_region = true; customer_master_key_spec = "ECC_NIST_P256"; key_usage = "SIGN_VERIFY" }
resource "aws_kms_replica_key" "audit_secondary" { provider = aws.secondary; primary_key_arn = aws_kms_key.audit_primary.arn; description = "IDLR staging audit signing key replica" }

locals {
  issuer_host = replace(var.cluster_oidc_issuer, "https://", "")
  recovery_subject = "system:serviceaccount:${var.namespace}:${var.recovery_service_account}"
  audit_subject = "system:serviceaccount:${var.namespace}:${var.audit_service_account}"
}
data "aws_iam_policy_document" "recovery_trust" {
  statement { actions = ["sts:AssumeRoleWithWebIdentity"]; principals { type = "Federated"; identifiers = [aws_iam_openid_connect_provider.eks.arn] }
    condition { test = "StringEquals"; variable = "${local.issuer_host}:aud"; values = ["sts.amazonaws.com"] }
    condition { test = "StringEquals"; variable = "${local.issuer_host}:sub"; values = [local.recovery_subject] }
  }
}
resource "aws_iam_role" "recovery" { name = "idlr-staging-recovery-worker"; assume_role_policy = data.aws_iam_policy_document.recovery_trust.json }
resource "aws_iam_role_policy" "recovery" {
  role = aws_iam_role.recovery.id
  policy = jsonencode({Version="2012-10-17",Statement=[{Effect="Allow",Action=["kms:GenerateDataKeyWithoutPlaintext","kms:ReEncryptFrom","kms:ReEncryptTo","kms:DescribeKey"],Resource=[aws_kms_key.recovery_primary.arn,aws_kms_replica_key.recovery_secondary.arn],Condition={StringEquals={"kms:ViaService"=["ec2.${var.primary_region}.amazonaws.com","ec2.${var.secondary_region}.amazonaws.com"]}}]})
}
data "aws_iam_policy_document" "audit_trust" {
  statement { actions=["sts:AssumeRoleWithWebIdentity"]; principals { type="Federated"; identifiers=[aws_iam_openid_connect_provider.eks.arn] }
    condition { test="StringEquals"; variable="${local.issuer_host}:aud"; values=["sts.amazonaws.com"] }
    condition { test="StringEquals"; variable="${local.issuer_host}:sub"; values=[local.audit_subject] }
  }
}
resource "aws_iam_role" "audit" { name="idlr-staging-audit-signer"; assume_role_policy=data.aws_iam_policy_document.audit_trust.json }
resource "aws_iam_role_policy" "audit" { role=aws_iam_role.audit.id; policy=jsonencode({Version="2012-10-17",Statement=[{Effect="Allow",Action=["kms:Sign","kms:GetPublicKey","kms:DescribeKey"],Resource=[aws_kms_key.audit_primary.arn,aws_kms_replica_key.audit_secondary.arn]}]}) }

output "recovery_primary_key_arn" { value = aws_kms_key.recovery_primary.arn }
output "recovery_secondary_key_arn" { value = aws_kms_replica_key.recovery_secondary.arn }
output "recovery_role_arn" { value = aws_iam_role.recovery.arn }
