export type StorageBucket = 'files' | 'worm';

export interface StoredObject {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly checksumSha256: string;
}

export interface StorageService {
  putObject(input: {
    bucket: StorageBucket;
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Readonly<Record<string, string>>;
  }): Promise<{ checksumSha256: string }>;
  getObject(input: { bucket: StorageBucket; key: string }): Promise<StoredObject>;
  headObject(input: { bucket: StorageBucket; key: string }): Promise<{ checksumSha256: string; contentLength: number }>;
  deleteObject(input: { bucket: StorageBucket; key: string }): Promise<void>;
}
