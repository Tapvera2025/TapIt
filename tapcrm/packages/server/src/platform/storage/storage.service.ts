import { MinioStorageProvider } from './minio.provider.js';
import type { StorageService } from './storage.types.js';

let service: StorageService | null = null;

export function getStorageService(): StorageService {
  return (service ??= new MinioStorageProvider());
}

export function __resetStorageService(): void {
  service = null;
}
