/**
 * NDSEP PDF Digital Signature Helper
 * ====================================
 * Applies a PKCS#7 detached CMS signature to a PDF buffer using the
 * platform's self-signed signing certificate (certs/ndsep-signing.crt).
 *
 * The signature is appended as a CMS SignedData object in DER format and
 * embedded in a PDF signature dictionary following PDF 1.7 / ISO 32000-1
 * (sub-filter: adbe.pkcs7.detached).
 *
 * Verification:
 *   openssl cms -verify -in sig.p7 -inform DER -content unsigned.pdf -noverify
 */

import forge from "node-forge";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

const CERT_PATH = path.resolve(process.cwd(), "certs/ndsep-signing.crt");
const KEY_PATH  = path.resolve(process.cwd(), "certs/ndsep-signing.key");

let _cert: forge.pki.Certificate | null = null;
let _key:  forge.pki.rsa.PrivateKey | null = null;

function loadCredentials() {
  if (_cert && _key) return { cert: _cert, key: _key };
  const certPem = fs.readFileSync(CERT_PATH, "utf8");
  const keyPem  = fs.readFileSync(KEY_PATH,  "utf8");
  _cert = forge.pki.certificateFromPem(certPem);
  _key  = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
  return { cert: _cert, key: _key };
}

/**
 * Sign a PDF buffer using PKCS#7 detached signature.
 * Returns a new Buffer containing the signed PDF with the signature appended.
 */
export async function signPdf(pdfBuffer: Buffer): Promise<Buffer> {
  const { cert, key } = loadCredentials();

  // Reserve 8192 hex chars (= 4096 bytes DER) for the signature placeholder
  const PLACEHOLDER_LEN = 8192;
  const placeholder = "0".repeat(PLACEHOLDER_LEN);

  // Build the signature dictionary to append to the PDF
  const sigDict =
    `\n%%NDSEP_SIG_START\n` +
    `1 0 obj\n` +
    `<< /Type /Sig\n` +
    `   /Filter /Adobe.PPKLite\n` +
    `   /SubFilter /adbe.pkcs7.detached\n` +
    `   /ByteRange [0 %%R1%% %%R2%% %%R3%%]\n` +
    `   /Contents <${placeholder}>\n` +
    `   /Reason (NDSEP Annual Audit Return - Platform Signature)\n` +
    `   /SigningTime (${new Date().toISOString()})\n` +
    `   /ContactInfo (compliance@ndsep.gov.ng)\n` +
    `   /Name (Nigeria Data Sovereignty Enforcement Platform)\n` +
    `>>\nendobj\n`;

  const combined = Buffer.concat([pdfBuffer, Buffer.from(sigDict, "binary")]);

  // Locate the /Contents < ... > placeholder
  const contentsTag = `/Contents <${placeholder.slice(0, 12)}`;
  const contentsStart = combined.indexOf(Buffer.from(contentsTag));
  if (contentsStart === -1) {
    logger.warn("[PdfSigner] Placeholder not found — returning unsigned PDF");
    return pdfBuffer;
  }

  const hexStart = contentsStart + "/Contents <".length;
  const hexEnd   = hexStart + PLACEHOLDER_LEN;

  // ByteRange: [0, hexStart, hexEnd+1, remaining]
  const r1 = hexStart;
  const r2 = hexEnd + 1;
  const r3 = combined.length - r2;

  // Patch ByteRange values
  const byteRangeOld = Buffer.from("[0 %%R1%% %%R2%% %%R3%%]");
  const byteRangeNew = Buffer.from(`[0 ${r1} ${r2} ${r3}]`.padEnd(byteRangeOld.length));
  const brIdx = combined.indexOf(byteRangeOld);
  if (brIdx !== -1) byteRangeNew.copy(combined, brIdx);

  // Compute PKCS#7 signature over the two byte ranges
  const dataToSign = Buffer.concat([combined.slice(0, r1), combined.slice(r2, r2 + r3)]);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(dataToSign.toString("binary"));
  p7.addCertificate(cert);
  p7.addSigner({
    key:         forge.pki.privateKeyToPem(key),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType,   value: forge.pki.oids.data as string },
      { type: forge.pki.oids.messageDigest, value: "" as string },
      { type: forge.pki.oids.signingTime,   value: new Date().toISOString() as string },
    ],
  });
  p7.sign({ detached: true });

  const derHex = Buffer.from(
    forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary"
  ).toString("hex");

  if (derHex.length > PLACEHOLDER_LEN) {
    logger.warn(`[PdfSigner] Signature too large (${derHex.length} > ${PLACEHOLDER_LEN}) — unsigned`);
    return pdfBuffer;
  }

  // Embed the signature hex into the placeholder
  Buffer.from(derHex.padEnd(PLACEHOLDER_LEN, "0"), "ascii").copy(combined, hexStart);

  return combined;
}

/** Rotate the signing certificate — generates a new RSA-2048 key pair and self-signed cert. */
export async function rotateCertificate(): Promise<{ subject: string; issuer: string; validFrom: string; validTo: string; serialNumber: string }> {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // Increment serial number
  const prevSerial = _cert ? parseInt(_cert.serialNumber, 16) || 1 : 1;
  cert.serialNumber = (prevSerial + 1).toString(16).padStart(2, '0');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs = [
    { name: 'commonName', value: 'NDSEP Platform' },
    { name: 'organizationName', value: 'Nigeria Data Sovereignty Enforcement Platform' },
    { name: 'organizationalUnitName', value: 'Digital Compliance Authority' },
    { name: 'countryName', value: 'NG' },
    { name: 'stateOrProvinceName', value: 'FCT Abuja' },
    { name: 'localityName', value: 'Abuja' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: false },
    { name: 'extKeyUsage', emailProtection: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  // Write new cert and key to disk
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem  = forge.pki.privateKeyToPem(keys.privateKey);
  fs.writeFileSync(CERT_PATH, certPem, 'utf8');
  fs.writeFileSync(KEY_PATH,  keyPem,  'utf8');
  // Invalidate cache
  _cert = cert;
  _key  = keys.privateKey as forge.pki.rsa.PrivateKey;
  logger.info(`[PdfSigner] Certificate rotated. New serial: ${cert.serialNumber}`);
  return getSigningCertInfo();
}

/** Returns certificate metadata for logging / API responses. */
export function getSigningCertInfo(): {
  subject: string; issuer: string; validFrom: string; validTo: string; serialNumber: string;
} {
  const { cert } = loadCredentials();
  const getAttr = (attrs: forge.pki.CertificateField[], name: string): string =>
    String(attrs.find(a => a.name === name)?.value ?? "");
  return {
    subject:      getAttr(cert.subject.attributes, "commonName"),
    issuer:       getAttr(cert.issuer.attributes,  "organizationName"),
    validFrom:    cert.validity.notBefore.toISOString(),
    validTo:      cert.validity.notAfter.toISOString(),
    serialNumber: cert.serialNumber,
  };
}
