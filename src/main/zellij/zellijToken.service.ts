import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class ZellijTokenService {
  private memoryToken: string | null = null;

  constructor(
    private readonly file: string,
    private readonly options: {
      persistent: boolean;
      available(): boolean;
      encrypt(token: string): Buffer;
      decrypt(bytes: Buffer): string;
    }
  ) {}

  read(): string | null {
    if (this.memoryToken) return this.memoryToken;
    if (!this.options.persistent) return null;
    try {
      if (!this.options.available()) throw new Error('secure-storage-unavailable');
      if (!existsSync(this.file)) return null;
      const token = this.options.decrypt(readFileSync(this.file));
      if (!/^[0-9a-f-]{36}$/iu.test(token)) throw new Error('secure-storage-unavailable');
      this.memoryToken = token;
      return token;
    } catch {
      throw new Error('secure-storage-unavailable');
    }
  }

  write(token: string): void {
    if (this.options.persistent) {
      try {
        if (!this.options.available()) throw new Error('secure-storage-unavailable');
        const ciphertext = this.options.encrypt(token);
        mkdirSync(dirname(this.file), { recursive: true });
        const temporary = `${this.file}.tmp`;
        writeFileSync(temporary, ciphertext, { mode: 0o600 });
        renameSync(temporary, this.file);
      } catch {
        throw new Error('secure-storage-unavailable');
      }
    }
    this.memoryToken = token;
  }
}
