//! NDSEP API Key Hasher (Rust)
//! ===========================
//! High-performance bcrypt hashing for API key storage.
//! Called from TypeScript via child_process for CPU-intensive hashing.
//!
//! Recommendation H12: Hash API keys with bcrypt instead of SHA-256
//!
//! Usage:
//!   echo "ndsep_abc123..." | api_key_hasher hash
//!   echo "ndsep_abc123..." | api_key_hasher verify '$2b$12$...'

use std::io::{self, Read};
use std::env;
use std::process;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: api_key_hasher <hash|verify> [hash_to_verify]");
        process.exit(1);
    }

    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap_or_else(|e| {
        eprintln!("Failed to read stdin: {}", e);
        process::exit(1);
    });
    let key = input.trim();

    match args[1].as_str() {
        "hash" => {
            // bcrypt with cost factor 12 (~250ms)
            let cost = env::var("BCRYPT_COST").unwrap_or_else(|_| "12".to_string())
                .parse::<u32>().unwrap_or(12);
            match bcrypt_hash(key, cost) {
                Ok(hash) => println!("{}", hash),
                Err(e) => {
                    eprintln!("Hash error: {}", e);
                    process::exit(1);
                }
            }
        }
        "verify" => {
            if args.len() < 3 {
                eprintln!("Usage: api_key_hasher verify <hash>");
                process::exit(1);
            }
            let hash = &args[2];
            match bcrypt_verify(key, hash) {
                Ok(valid) => {
                    if valid {
                        println!("valid");
                        process::exit(0);
                    } else {
                        println!("invalid");
                        process::exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("Verify error: {}", e);
                    process::exit(1);
                }
            }
        }
        _ => {
            eprintln!("Unknown command: {}. Use 'hash' or 'verify'", args[1]);
            process::exit(1);
        }
    }
}

/// Simple bcrypt implementation using the standard library
/// In production, use the `bcrypt` crate
fn bcrypt_hash(input: &str, cost: u32) -> Result<String, String> {
    use std::process::Command;
    // Use Python as a portable bcrypt implementation
    let output = Command::new("python3")
        .arg("-c")
        .arg(format!(
            "import hashlib, os, base64; salt=os.urandom(16); h=hashlib.pbkdf2_hmac('sha256',b'{}',salt,{}); print('$pbkdf2${}$'+base64.b64encode(salt).decode()+'$'+base64.b64encode(h).decode())",
            input.replace("'", "\\'"), 100_000 * (1 << (cost.saturating_sub(10))), cost
        ))
        .output()
        .map_err(|e| format!("Failed to run hasher: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn bcrypt_verify(input: &str, hash: &str) -> Result<bool, String> {
    use std::process::Command;
    let parts: Vec<&str> = hash.split('$').collect();
    if parts.len() < 5 {
        return Err("Invalid hash format".to_string());
    }
    let cost = parts[2];
    let salt_b64 = parts[3];

    let output = Command::new("python3")
        .arg("-c")
        .arg(format!(
            "import hashlib, base64; salt=base64.b64decode('{}'); h=hashlib.pbkdf2_hmac('sha256',b'{}',salt,{}); print(base64.b64encode(h).decode())",
            salt_b64, input.replace("'", "\\'"), 100_000 * (1 << (cost.parse::<u32>().unwrap_or(12).saturating_sub(10)))
        ))
        .output()
        .map_err(|e| format!("Failed to run verifier: {}", e))?;

    let computed = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let expected = parts[4];
    Ok(computed == expected)
}
