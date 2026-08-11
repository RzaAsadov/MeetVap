import { X509Certificate } from 'crypto';
import cbor from 'cbor';

type AppAttestModule = {
  verifyAssertion: (input: {
    assertion: Buffer;
    bundleIdentifier: string;
    payload: Buffer;
    publicKey: string;
    signCount: number;
    teamIdentifier: string;
  }) => { signCount: number };
  verifyAttestation: (input: {
    allowDevelopmentEnvironment: boolean;
    attestation: Buffer;
    bundleIdentifier: string;
    challenge: Buffer;
    keyId: string;
    teamIdentifier: string;
  }) => {
    environment: 'development' | 'production';
    keyId: string;
    publicKey: string;
    receipt: Buffer;
  };
};

export type VerifiedAppleAttestation = {
  appBuildNumber: number;
  environment: 'development' | 'production';
  publicKeyPem: string;
  receiptBase64: string;
  validationCategory: number;
};

let appAttestModulePromise: Promise<AppAttestModule> | null = null;

export async function verifyAppleAttestation(input: {
  allowDevelopmentEnvironment: boolean;
  appIdPrefix: string;
  attestationObject: string;
  bundleIdentifier: string;
  challenge: string;
  keyId: string;
}) {
  const attestation = decodeBase64(input.attestationObject, 'attestation object');
  const challenge = decodeBase64Url(input.challenge, 'challenge');
  const decoded = decodeAttestationObject(attestation);

  verifyCertificateValidity(decoded.certificates);
  const verifier = await loadAppAttestModule();
  const verified = verifier.verifyAttestation({
    allowDevelopmentEnvironment: input.allowDevelopmentEnvironment,
    attestation,
    bundleIdentifier: input.bundleIdentifier,
    challenge,
    keyId: input.keyId,
    teamIdentifier: input.appIdPrefix,
  });
  const extensions = decodeAuthenticatorExtensions(decoded.authData);
  const validationCategory = readIntegerExtension(extensions, 'apple_validation_category_01');
  const bundleVersion = readStringExtension(extensions, 'apple_bundle_version_01');
  const appBuildNumber = Number(bundleVersion);
  const allowedCategories = verified.environment === 'development' ? [3] : [2, 4];

  if (!allowedCategories.includes(validationCategory)) {
    throw new Error(`app_attest_validation_category_${validationCategory}`);
  }

  if (!Number.isSafeInteger(appBuildNumber) || appBuildNumber < 1) {
    throw new Error('app_attest_bundle_version_invalid');
  }

  return {
    appBuildNumber,
    environment: verified.environment,
    publicKeyPem: verified.publicKey,
    receiptBase64: verified.receipt.toString('base64'),
    validationCategory,
  } satisfies VerifiedAppleAttestation;
}

export async function verifyAppleAssertion(input: {
  appIdPrefix: string;
  assertionObject: string;
  bundleIdentifier: string;
  challenge: string;
  publicKeyPem: string;
  signCount: number;
}) {
  const verifier = await loadAppAttestModule();

  return verifier.verifyAssertion({
    assertion: decodeBase64(input.assertionObject, 'assertion object'),
    bundleIdentifier: input.bundleIdentifier,
    payload: decodeBase64Url(input.challenge, 'challenge'),
    publicKey: input.publicKeyPem,
    signCount: input.signCount,
    teamIdentifier: input.appIdPrefix,
  });
}

function decodeAttestationObject(attestation: Buffer) {
  const decodedItems = cbor.decodeAllSync(attestation);

  if (decodedItems.length !== 1 || !isRecord(decodedItems[0])) {
    throw new Error('app_attest_object_invalid');
  }

  const decoded = decodedItems[0];
  const statement = decoded.attStmt;
  const authData = decoded.authData;

  if (!isRecord(statement) || !Array.isArray(statement.x5c) || !Buffer.isBuffer(authData)) {
    throw new Error('app_attest_object_invalid');
  }

  const certificates = statement.x5c.map((value) => {
    if (!Buffer.isBuffer(value)) {
      throw new Error('app_attest_certificate_invalid');
    }

    return new X509Certificate(value);
  });

  if (certificates.length !== 2) {
    throw new Error('app_attest_certificate_chain_invalid');
  }

  return { authData, certificates };
}

function verifyCertificateValidity(certificates: X509Certificate[]) {
  const now = Date.now();

  certificates.forEach((certificate) => {
    const validFrom = Date.parse(certificate.validFrom);
    const validTo = Date.parse(certificate.validTo);

    if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now > validTo) {
      throw new Error('app_attest_certificate_expired');
    }
  });
}

function decodeAuthenticatorExtensions(authData: Buffer) {
  if (authData.length < 87) {
    throw new Error('app_attest_authenticator_data_invalid');
  }

  const credentialIdLength = authData.readUInt16BE(53);
  const encodedCredentialAndExtensions = authData.subarray(55 + credentialIdLength);
  const decoded = cbor.decodeAllSync(encodedCredentialAndExtensions);
  const extensions = decoded.at(-1);

  if (decoded.length < 2 || !(extensions instanceof Map)) {
    throw new Error('app_attest_extensions_missing');
  }

  return extensions as Map<unknown, unknown>;
}

function readIntegerExtension(extensions: Map<unknown, unknown>, key: string) {
  const value = unwrapCborValue(extensions.get(key));

  if (Buffer.isBuffer(value) && value.length === 4) {
    return value.readUInt32LE();
  }

  const number = typeof value === 'bigint' ? Number(value) : value;

  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw new Error(`app_attest_extension_${key}_invalid`);
  }

  return number;
}

function readStringExtension(extensions: Map<unknown, unknown>, key: string) {
  const value = unwrapCborValue(extensions.get(key));

  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  throw new Error(`app_attest_extension_${key}_invalid`);
}

function unwrapCborValue(value: unknown): unknown {
  if (isRecord(value) && 'value' in value) {
    return value.value;
  }

  return value;
}

function decodeBase64(value: string, label: string) {
  const normalized = value.trim();

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(`Invalid ${label}`);
  }

  return Buffer.from(normalized, 'base64');
}

function decodeBase64Url(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }

  return Buffer.from(value, 'base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function loadAppAttestModule() {
  if (!appAttestModulePromise) {
    // TypeScript compiles this server as CommonJS. Native dynamic import keeps
    // the ESM-only verifier loadable without changing the whole server format.
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<AppAttestModule>;
    appAttestModulePromise = dynamicImport('node-app-attest');
  }

  return appAttestModulePromise;
}
