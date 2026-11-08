$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$checkout = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$branch = git -C $checkout branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch -ne 'codex/offline-release-integration' -or (Split-Path $checkout -Leaf) -ne 'offline-release-integration') { throw 'Checkout incorrecto. Ejecucion detenida.' }
if (!(Test-Path (Join-Path $checkout 'backend/node_modules/pg'))) { throw 'Faltan dependencias del backend. Ejecucion detenida.' }
function Read-Secret([string]$Prompt, [string]$Check) {
    $secure = Read-Host $Prompt -AsSecureString
    if ($secure.Length -eq 0) { $secure.Dispose(); throw "FAIL comprobacion: $Check | Credencial vacia. Ejecucion detenida." }
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
}
$names = @('DATABASE_URL','MIGRATION_DATABASE_URL','JWT_SECRET','ANDROID_OFFLINE_ENABLED','NODE_ENV','ALLFIX_NEON_KEY','ALLFIX_NEON_PROJECT','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:ALLFIX_NEON_PROJECT = 'green-mouse-83526553'
    $env:NODE_OPTIONS = ''
    $env:NODE_EXTRA_CA_CERTS = ''
    $env:NODE_TLS_REJECT_UNAUTHORIZED = '1'
    if ((node --version) -notmatch '^v22\.') { throw 'Se requiere Node 22 en esta terminal.' }
    $env:ALLFIX_NEON_KEY = Read-Secret 'API key de Neon para verificar rama y endpoint (entrada oculta)' 'api-key-neon'
    $env:DATABASE_URL = Read-Secret 'URL PostgreSQL DIRECTA runtime de staging, completa (entrada oculta)' 'credencial-runtime'
    $env:MIGRATION_DATABASE_URL = Read-Secret 'URL PostgreSQL DIRECTA administrativa de staging, completa (entrada oculta; solo fixtures)' 'credencial-administrativa'
    # A fresh key isolates these local test sessions from every installed APK.
    $env:JWT_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $env:ANDROID_OFFLINE_ENABLED = 'true'
    $env:NODE_ENV = 'test'
    & node (Join-Path $PSScriptRoot 'validate-android-staging.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Validacion incompleta o fallida; revisa el resultado seguro anterior.' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
