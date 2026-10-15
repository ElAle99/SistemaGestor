For the current runtime model, deployment variables and validated security fixes,
see RLS_HARDENING.md (168/168 live checks). The following describes the original
data-preserving migration, whose connection model was hardened on 20261014.

The 20261013 migration runs after the existing schema, warranty and catalog migrations.
It uses one transaction and an advisory lock, records a version, and verifies counts
and full JSON fingerprints (excluding the new negocio_id) before committing.
Ambiguous catalog scopes/business matching abort the whole transaction.

The existing configuration row retains its ID and every value. Its business is
resolved from existing ownership, an unambiguous business-name match, or the one
legacy catalog scope. If no negocios registry existed, that existing business is
registered using its configured name. The pre-migration configuration is retained
in administrator-only tenant_migraciones for audit, never used as a runtime fallback.
The migration CLI also saves an ignored local backup of configuration and counts.

Authenticated users derive ownership from the database on every request, not tenant
claims in the JWT, body, or query string. AsyncLocalStorage carries that ownership
to PostgreSQL. Pooled tenant connections log in as sistema_gestor_app, inheriting
only the restricted sistema_gestor_tenant policies. They never use SET ROLE or an
administrative login. SET LOCAL expires with each commit/rollback before reuse.
Requests without a tenant see no protected data. Schema initialization runs only
through the administrative CLI; authentication uses narrow SQL capabilities.
Folio lookup now requires an authenticated tenant. withSystemContext cannot elevate
the runtime pool. None of these paths serves another tenant's configuration.
The configuration endpoint exposes a server-verified legacy-business boolean from
migration metadata through a restricted SQL function. Only that business may import the old
browser-local printer preferences into its new scope, using the existing preference
API. Other businesses receive fresh preferences; physical printer settings are not
silently lost or copied to another business.

New businesses inserted by a trusted provisioner receive independent configuration
and user-creation settings automatically. No legacy contact, logo or legal text is
copied. Provisioning usuarios must assign the business explicitly; app users may
only create accounts within their own tenant. Business registry creation is not
exposed as an unrestricted tenant-switching HTTP endpoint.

Logos retain their existing paths. A registry verifies ownership when configuration
is saved. Their image URLs remain publicly renderable as before; logo ownership is
isolated, but this migration does not turn public branding images into private files.

Existing folios and payment values remain unchanged. New order folios use a global
atomic counter, keeping the existing AFB-year-number format and uniqueness without
reading another tenant's orders. The print transports, encoders, queues and paper
profiles do not change.
The v2 migration scopes the existing one-open-register and product-code uniqueness
rules by negocio_id, without changing balances, movements or stock values.

Run `node backend/scripts/migrate-tenancy.js` with application writers stopped.
Restart the updated application afterward. Failed migrations roll back completely.
Re-running the applied migration is a no-op. Do not remove ownership/RLS after new
businesses have data: downgrading would expose their data. Recovery after commit
requires an administrator-controlled full database restore, not merging tenants.
