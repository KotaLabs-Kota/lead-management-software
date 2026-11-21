/**
 * Minimal ambient declaration for `embedded-postgres`.
 *
 * The package ships ESM-style type declarations (`.js` extension imports)
 * which cannot be resolved with the project's `moduleResolution: "Node"`.
 * This declaration mirrors the public API used by the test setup.
 */
declare module 'embedded-postgres' {
  export interface PostgresOptions {
    databaseDir: string;
    port: number;
    user: string;
    password: string;
    authMethod?: 'scram-sha-256' | 'password' | 'md5';
    persistent?: boolean;
    initdbFlags?: string[];
    postgresFlags?: string[];
    createPostgresUser?: boolean;
    autoRehydrateSymlinks?: boolean;
    onLog?: (message: string) => void;
    onError?: (messageOrError: string | Error | unknown) => void;
  }

  export default class EmbeddedPostgres {
    constructor(options?: Partial<PostgresOptions>);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
  }
}
