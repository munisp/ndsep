-- Rollback: Remove liveness_checks table and kyc_records columns
ALTER TABLE kyc_records DROP COLUMN IF EXISTS liveness_check_id;
ALTER TABLE kyc_records DROP COLUMN IF EXISTS face_embedding;
DROP TABLE IF EXISTS liveness_checks;
