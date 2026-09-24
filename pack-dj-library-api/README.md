# PACK TODOS LOS GÉNEROS — staging API

This is a separate staging-only copy of the Drive library API. It must never be connected to or deployed through the production RCmusic_eventos service.

## Isolated resources

- Supabase project: `https://uwvhpodseawpsqunplld.supabase.co`. Configure only its publishable/anon key as `SUPABASE_ANON_KEY`; never use a service-role key.
- Google Cloud project: `level-calculus-509619-m0` (`PACK DJ Biblioteca API`). Drive service account: `pack-dj-drive@level-calculus-509619-m0.iam.gserviceaccount.com`.
- Google Drive folder: `1UTIQESYvJcNdKXNsDdDs0dRCrDzs5JvF` (`PACK TODOS LOS GENEROS ➡️​➡️​➡️`).

## Safe Drive configuration

The preferred staging credential is `GOOGLE_SERVICE_ACCOUNT_JSON`, configured only in the staging host's secret store. The API signs a short-lived service-account assertion and requests the `drive.readonly` OAuth scope. Share only the verified PACK folder to the service account as **Reader**. No folder share has been completed yet. Do not grant Writer/Editor; those roles could permit modifying folder contents and would require separate, explicit authorization.

In service-account readonly mode, the catalog and streaming endpoints are read-only. The API does not reconcile, grant, change, or revoke Drive permissions; permission-management requests return `DRIVE_PERMISSION_MANAGEMENT_REQUIRES_SEPARATE_APPROVAL`. Automatic temporary DJ permissions therefore remain blocked until an appropriately scoped, specifically approved permission design is available. The legacy user-OAuth token path remains in the server source for compatibility but is not the staging configuration in `render.yaml`.

## Staging deployment

- Render blueprint: `render.yaml`, service name `pack-todos-los-generos-staging-api`.
- Configure `SUPABASE_ANON_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, and `CORS_ORIGIN` as staging secrets/settings. Keep `DRIVE_FOLDER_ID` fixed to the PACK folder ID.
- Set `CORS_ORIGIN` to the exact, verified standalone PWA staging origin(s), comma-separated if needed. Do not guess the hostname or allow `*`.
- Once the separate API has a verified staging URL, set the standalone PWA build variable `VITE_DJ_LIBRARY_API_BASE_URL` to that origin plus `/api`.

No Render staging API has been deployed or runtime-tested. The correct standalone PWA staging origin is not yet verified, the folder has not yet been shared with the service account, and a permission-level decision is still needed to enable automatic DJ permission management.
