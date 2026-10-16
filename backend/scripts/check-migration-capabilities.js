// Administrative CLI only. Read-only: run before schema creation or migrations.
async function checkMigrationCapabilities(pool) {
  const { rows: [role] } = await pool.query(`SELECT current_user, session_user,
    rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname=current_user`);
  if (!role || !(role.rolsuper || (role.rolbypassrls && role.rolcreaterole))) {
    throw new Error('La arquitectura RLS actual requiere un administrador con bypass de RLS y capacidad de administrar roles para los propietarios SECURITY DEFINER. Render Managed PostgreSQL debe verificar estos permisos; no desactives FORCE RLS.');
  }
  return role;
}
module.exports = { checkMigrationCapabilities };
if (require.main === module) {
  const { pool } = require('../config/migrationDb');
  checkMigrationCapabilities(pool).then(role => console.log(JSON.stringify(role)))
    .catch(() => { console.error('Preflight administrativo rechazado: se requiere administrador SUPERUSER o BYPASSRLS + CREATEROLE, con propiedad/permisos para migrar el esquema. Revisa MIGRATION_DATABASE_URL sin publicar su valor.'); process.exitCode = 1; })
    .finally(() => pool.end());
}
