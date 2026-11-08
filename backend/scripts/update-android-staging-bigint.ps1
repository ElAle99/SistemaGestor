param([ValidateSet('Check','Apply')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$backend = Split-Path $PSScriptRoot -Parent
if ((git -C $backend branch --show-current) -ne 'codex/offline-release-integration') { throw 'Rama local incorrecta.' }
if ((node --version) -notmatch '^v22\.') { throw 'Usar Node 22.' }
if (Test-Path (Join-Path $backend '.env')) { throw 'No se permite cargar .env en esta operacion.' }
function Read-Private([string]$Label) {
    $secure = Read-Host $Label -AsSecureString
    if (!$secure.Length) { $secure.Dispose(); throw 'Credencial ausente; detener.' }
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
}
$names = @('MIGRATION_DATABASE_URL','ANDROID_RUNTIME_ROLE','DB_SSL','DB_SSL_REJECT_UNAUTHORIZED','DB_SSL_CA','NODE_OPTIONS')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$key = $null; $raw = $null; $uri = $null; $headers = $null
try {
    $key = Read-Private 'API key de Neon, solo para verificar STAGING (oculta)'
    $headers = @{ Authorization = 'Bearer ' + $key }
    $api = 'https://console.neon.tech/api/v2/projects/green-mouse-83526553'
    try {
        $branch = (Invoke-RestMethod -Uri ($api + '/branches/br-dawn-heart-bd3sqd27') -Headers $headers -Method Get -TimeoutSec 15).branch
        $endpoint = (Invoke-RestMethod -Uri ($api + '/endpoints/ep-blue-lab-bdnti3ov') -Headers $headers -Method Get -TimeoutSec 15).endpoint
    } catch { throw 'No se pudo verificar destino staging mediante API; no se conecto PostgreSQL.' }
    if ($branch.id -ne 'br-dawn-heart-bd3sqd27' -or $branch.name -cne 'allfix-staging-offline' -or
        $branch.default -or $branch.protected -or $endpoint.branch_id -ne $branch.id -or
        $endpoint.id -ne 'ep-blue-lab-bdnti3ov' -or $endpoint.type -ne 'read_write' -or $endpoint.disabled -or
        $endpoint.host -cne 'ep-blue-lab-bdnti3ov.c-8.us-east-2.aws.neon.tech') { throw 'Destino staging no confirmado; detener.' }
    $key = $null; $headers = $null
    $raw = Read-Private 'URL administrativa DIRECTA de STAGING/allfix_db (oculta)'
    try { $uri = [Uri]$raw } catch { throw 'Formato de conexion invalido.' }
    if ($uri.Scheme -notin @('postgres','postgresql') -or
        $uri.Host -cne 'ep-blue-lab-bdnti3ov.c-8.us-east-2.aws.neon.tech' -or $uri.AbsolutePath -cne '/allfix_db' -or
        ($uri.Port -ne -1 -and $uri.Port -ne 5432) -or $uri.Fragment -or
        $uri.UserInfo -notmatch '^allfix_db_owner:.+') { throw 'URL distinta del administrador y destino staging verificados.' }
    $pairs = $uri.Query.TrimStart('?').Split('&')
    if (!($pairs -contains 'sslmode=require') -and !($pairs -contains 'sslmode=verify-full')) { throw 'TLS requerido.' }
    foreach ($pair in $pairs) {
        if ($pair -notmatch '^(sslmode=(require|verify-full)|channel_binding=require)$') { throw 'Parametro de conexion no permitido.' }
    }
    $env:MIGRATION_DATABASE_URL = $raw
    $env:ANDROID_RUNTIME_ROLE = 'sistema_gestor_app'
    $env:DB_SSL = 'true'
    $env:DB_SSL_REJECT_UNAUTHORIZED = 'true'
    $env:DB_SSL_CA = ''
    $env:NODE_OPTIONS = ''
    & node (Join-Path $PSScriptRoot 'migrate-android-offline.js') --check
    if ($LASTEXITCODE -ne 0) { throw 'Check staging fallo; no aplicar.' }
    if ($Mode -eq 'Apply') {
        & node (Join-Path $PSScriptRoot 'migrate-android-offline.js') --apply
        if ($LASTEXITCODE -ne 0) { throw 'Actualizacion staging fallo; detener, sin reintento automatico.' }
        & node (Join-Path $PSScriptRoot 'migrate-android-offline.js') --check
        if ($LASTEXITCODE -ne 0) { throw 'Check posterior fallo.' }
    }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    $key = $null; $headers = $null; $raw = $null; $uri = $null
}
