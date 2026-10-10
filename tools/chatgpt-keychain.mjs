import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Only the local process sees these bytes. The encryption key lives in the OS
// credential store; OAuth state on disk is authenticated ciphertext.
export function keychainEncryption(entry) {
  let key;
  const load = () => {
    if (!key) {
      const saved = entry.getPassword();
      if (saved) {
        key = Buffer.from(saved, 'base64');
        if (key.length !== 32) throw new Error('Invalid credential encryption key');
      }
    }
    return key;
  };
  return {
    id: 'altertale-os-keychain-aes256gcm-v1',
    isAvailable() { try { load(); return true; } catch { return false; } },
    encrypt(plaintext) {
      if (!load()) {
        const candidate = randomBytes(32);
        entry.setPassword(candidate.toString('base64'));
        key = Buffer.from(entry.getPassword(), 'base64');
        if (key.length !== 32) throw new Error('Credential store is unavailable');
      }
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decrypt(bytes) {
      const saved = load();
      if (!saved) throw new Error('The original OS credential key is unavailable');
      const buffer = Buffer.from(bytes);
      if (buffer.length < 28) throw new Error('Invalid encrypted credential state');
      const decipher = createDecipheriv('aes-256-gcm', saved, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(-16));
      return Buffer.concat([decipher.update(buffer.subarray(12, -16)), decipher.final()]).toString('utf8');
    }
  };
}

export async function systemEncryption() {
  const { Entry } = await import('@napi-rs/keyring');
  // Persistent Secret Service on Linux, Keychain on macOS, Credential Manager
  // on Windows. Do not silently fall back to a nonpersistent Linux keyring.
  return keychainEncryption(new Entry('altertale-chatgpt', 'credentials-v1', { linux: { store: 'secret-service' } }));
}
