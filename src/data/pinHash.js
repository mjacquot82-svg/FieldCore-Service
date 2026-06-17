const HASH_ALGORITHM = 'SHA-256';
const HASH_ITERATIONS = 100000;
const HASH_PREFIX = 'pbkdf2-sha256';

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomSalt() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function derivePinHash(pin, salt, iterations = HASH_ITERATIONS) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is required for PIN hashing.');
  }

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(String(pin || '').trim()),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations,
      hash: HASH_ALGORITHM
    },
    key,
    256
  );

  return bytesToHex(bits);
}

export function isPinHash(value) {
  return typeof value === 'string' && value.startsWith(`${HASH_PREFIX}$`);
}

export async function hashPin(pin) {
  const normalizedPin = String(pin || '').trim();
  if (!normalizedPin) return null;

  const salt = randomSalt();
  const hash = await derivePinHash(normalizedPin, salt);
  return `${HASH_PREFIX}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

export async function verifyPin(pin, pinHash) {
  if (!isPinHash(pinHash)) return false;

  const [, iterations, salt, expectedHash] = pinHash.split('$');
  if (!iterations || !salt || !expectedHash) return false;
  const iterationCount = Number(iterations);
  if (!Number.isFinite(iterationCount) || iterationCount <= 0) return false;

  const candidateHash = await derivePinHash(pin, salt, iterationCount);
  return candidateHash === expectedHash;
}
