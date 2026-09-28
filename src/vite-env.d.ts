/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_SUPABASE_URL: string
  readonly VITE_AUTH_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_AUTH_APP_URL?: string
  readonly VITE_SERVICE_DATA_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
