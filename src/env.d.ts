/// <reference types="vite/client" />
/// <reference types="react" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  // add other env vars if you use them, e.g. VITE_API_URL
  readonly [key: string]: string | boolean | number | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
