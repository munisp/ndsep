//! Core PQC cryptographic operations using CRYSTALS-Kyber and CRYSTALS-Dilithium

use anyhow::{anyhow, Result};
use pqcrypto_kyber::kyber768;
use pqcrypto_dilithium::dilithium3;
use pqcrypto_traits::kem::{PublicKey as _, SecretKey as _, SharedSecret as _, Ciphertext as _};
use pqcrypto_traits::sign::{PublicKey as _, SecretKey as _, DetachedSignature as _};
use sha3::{Digest, Sha3_256};

pub struct PQCKeyPair {
    pub public_key: Vec<u8>,
    pub secret_key: Vec<u8>,
    pub key_id: String,
    pub fingerprint: String,
}

pub struct PQCOps;

impl PQCOps {
    pub fn new() -> Self {
        Self
    }

    pub fn generate_keypair(&self, algorithm: &str) -> Result<PQCKeyPair> {
        let (pk, sk) = match algorithm {
            "kyber768" | "kyber1024" => {
                let (pk, sk) = kyber768::keypair();
                (pk.as_bytes().to_vec(), sk.as_bytes().to_vec())
            }
            "dilithium3" | "dilithium5" => {
                let (pk, sk) = dilithium3::keypair();
                (pk.as_bytes().to_vec(), sk.as_bytes().to_vec())
            }
            _ => return Err(anyhow!("Unsupported algorithm: {}", algorithm)),
        };

        let digest = Sha3_256::digest(&pk);
        let fingerprint = hex::encode(digest.as_slice());
        let key_id = format!("ndsep_{}_{}", algorithm, &fingerprint[..16]);

        Ok(PQCKeyPair {
            public_key: pk,
            secret_key: sk,
            key_id,
            fingerprint,
        })
    }

    pub fn encapsulate(&self, public_key: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
        let pk = kyber768::PublicKey::from_bytes(public_key)
            .map_err(|_| anyhow!("Invalid Kyber768 public key (expected {} bytes)", kyber768::public_key_bytes()))?;
        let (ss, ct) = kyber768::encapsulate(&pk);
        Ok((ct.as_bytes().to_vec(), ss.as_bytes().to_vec()))
    }

    pub fn decapsulate(&self, ciphertext: &[u8], secret_key: &[u8]) -> Result<Vec<u8>> {
        let sk = kyber768::SecretKey::from_bytes(secret_key)
            .map_err(|_| anyhow!("Invalid Kyber768 secret key"))?;
        let ct = kyber768::Ciphertext::from_bytes(ciphertext)
            .map_err(|_| anyhow!("Invalid Kyber768 ciphertext"))?;
        let ss = kyber768::decapsulate(&ct, &sk);
        Ok(ss.as_bytes().to_vec())
    }

    pub fn sign(&self, message: &[u8], secret_key: &[u8]) -> Result<Vec<u8>> {
        let sk = dilithium3::SecretKey::from_bytes(secret_key)
            .map_err(|_| anyhow!("Invalid Dilithium3 secret key (expected {} bytes)", dilithium3::secret_key_bytes()))?;
        let sig = dilithium3::detached_sign(message, &sk);
        Ok(sig.as_bytes().to_vec())
    }

    pub fn verify(&self, message: &[u8], signature: &[u8], public_key: &[u8]) -> Result<bool> {
        let pk = dilithium3::PublicKey::from_bytes(public_key)
            .map_err(|_| anyhow!("Invalid Dilithium3 public key"))?;
        let sig = dilithium3::DetachedSignature::from_bytes(signature)
            .map_err(|_| anyhow!("Invalid Dilithium3 signature"))?;
        match dilithium3::verify_detached_signature(&sig, message, &pk) {
            Ok(()) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}

mod hex {
    pub fn encode(data: &[u8]) -> String {
        data.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kyber_keygen_encapsulate_decapsulate() {
        let ops = PQCOps::new();
        let kp = ops.generate_keypair("kyber768").unwrap();
        assert!(!kp.public_key.is_empty());
        assert!(!kp.secret_key.is_empty());

        let (ct, ss1) = ops.encapsulate(&kp.public_key).unwrap();
        let ss2 = ops.decapsulate(&ct, &kp.secret_key).unwrap();
        assert_eq!(ss1, ss2, "Shared secrets must match after KEM roundtrip");
    }

    #[test]
    fn test_dilithium_sign_verify() {
        let ops = PQCOps::new();
        let kp = ops.generate_keypair("dilithium3").unwrap();
        let message = b"NDPA compliance attestation for Org-42";

        let sig = ops.sign(message, &kp.secret_key).unwrap();
        let valid = ops.verify(message, &sig, &kp.public_key).unwrap();
        assert!(valid, "Signature must verify with correct key");

        // Tampered message should fail
        let tampered = b"NDPA compliance attestation for Org-99";
        let invalid = ops.verify(tampered, &sig, &kp.public_key).unwrap();
        assert!(!invalid, "Signature must not verify with tampered message");
    }
}
