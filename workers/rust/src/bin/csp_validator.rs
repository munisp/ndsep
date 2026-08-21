//! NDSEP CSP Validator (Rust)
//! ===========================
//! Validates Content Security Policy headers against known inline scripts.
//! Checks if nonce-based or hash-based CSP is correctly applied.
//!
//! Recommendation M16: Evaluate nonce-based vs hash-based CSP
//!
//! Usage:
//!   echo "https://ndsep.ng" | csp_validator

use std::io::{self, BufRead};
use std::process;
use std::process::Command;

fn main() {
    let stdin = io::stdin();
    let url = stdin.lock().lines().next()
        .and_then(|l| l.ok())
        .unwrap_or_else(|| {
            eprintln!("Usage: echo 'https://url' | csp_validator");
            process::exit(1);
        });

    println!("=== NDSEP CSP Validation Report ===");
    println!("Target: {}", url);
    println!();

    // Fetch headers using curl
    let output = Command::new("curl")
        .args(&["-sI", &url, "--max-time", "10"])
        .output();

    match output {
        Ok(out) => {
            let headers = String::from_utf8_lossy(&out.stdout);
            let mut csp_found = false;
            let mut csp_value = String::new();

            for line in headers.lines() {
                let lower = line.to_lowercase();
                if lower.starts_with("content-security-policy:") {
                    csp_found = true;
                    csp_value = line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
                    println!("[FOUND] Content-Security-Policy header present");
                    println!("  Value: {}", &csp_value[..csp_value.len().min(200)]);
                    println!();
                }
                if lower.starts_with("strict-transport-security:") {
                    println!("[OK] HSTS header present: {}", line.splitn(2, ':').nth(1).unwrap_or("").trim());
                }
                if lower.starts_with("x-content-type-options:") {
                    println!("[OK] X-Content-Type-Options: {}", line.splitn(2, ':').nth(1).unwrap_or("").trim());
                }
                if lower.starts_with("x-frame-options:") {
                    println!("[OK] X-Frame-Options: {}", line.splitn(2, ':').nth(1).unwrap_or("").trim());
                }
            }

            if !csp_found {
                println!("[WARN] No Content-Security-Policy header found!");
                println!("  Recommendation: Add CSP header via Helmet.js middleware");
                process::exit(1);
            }

            // Analyze CSP directives
            println!("\n--- CSP Directive Analysis ---");
            let directives: Vec<&str> = csp_value.split(';').collect();
            for directive in &directives {
                let d = directive.trim();
                if d.is_empty() { continue; }
                let parts: Vec<&str> = d.splitn(2, ' ').collect();
                let name = parts[0];
                let value = if parts.len() > 1 { parts[1] } else { "" };

                // Check for unsafe patterns
                if value.contains("'unsafe-inline'") {
                    println!("[WARN] {}: contains 'unsafe-inline' — weakens XSS protection", name);
                }
                if value.contains("'unsafe-eval'") {
                    println!("[WARN] {}: contains 'unsafe-eval' — allows eval() attacks", name);
                }
                if value.contains("'nonce-") {
                    println!("[OK] {}: uses nonce-based CSP", name);
                }
                if value.contains("'sha256-") || value.contains("'sha384-") {
                    println!("[OK] {}: uses hash-based CSP", name);
                }
                if value.contains("*") && name != "img-src" {
                    println!("[WARN] {}: wildcard source — overly permissive", name);
                }
                if value == "'none'" {
                    println!("[OK] {}: blocked ('none')", name);
                }
                if value == "'self'" {
                    println!("[OK] {}: restricted to same origin", name);
                }
            }

            println!("\n--- Recommendations ---");
            if csp_value.contains("'unsafe-inline'") {
                println!("1. Replace 'unsafe-inline' with nonce-based CSP for script-src");
                println!("   In development: Keep 'unsafe-inline' for Vite HMR");
                println!("   In production: Use 'nonce-{random}' with Helmet CSP middleware");
            }
            if csp_value.contains("'unsafe-eval'") {
                println!("2. Remove 'unsafe-eval' from script-src in production");
            }
            println!();
            println!("=== Validation Complete ===");
        }
        Err(e) => {
            eprintln!("Failed to fetch headers: {}", e);
            process::exit(1);
        }
    }
}
