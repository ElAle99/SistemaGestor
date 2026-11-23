# Backend opcional de Online-First

El endpoint autenticado GET /api/android/receipts/:id consulta el recibo del UUID bajo el negocio y usuario de la sesión. Devuelve ID, folio y resultado, sin los detalles de recepción. Un 404 indica ausencia de recibo visible y permite conservar el caso para revisión.

Cuando /api/android/capabilities anuncia onlineCreate, Android envía creaciones mediante /api/android/operations con flow=online-first. El mismo recibo y la orden comparten transacción. Las creaciones rápidas con anticipo, catálogo o fotos y las creaciones desde el editor completo requieren esta capacidad. El protocolo 1 existente sigue disponible para recepción rápida ordinaria.

ANDROID_RETIRE_LEGACY_WRITES=true rechaza nuevas aplicaciones del protocolo heredado con HTTP 426. Los recibos previamente confirmados siguen accesibles y el mismo UUID con igual contenido conserva el resultado. Este ajuste se limita a /api/android/operations. Las rutas compartidas con la web requieren un control adicional para distinguir clientes antiguos antes de un retiro general. La variable se deja desactivada por defecto.

La rama reutiliza las tablas existentes. El validador de Staging verifica el destino, crea negocios sintéticos con marcadores aleatorios y comprueba su limpieza. La entrada consiste en un JSON por stdin sin eco. Campos requeridos: branchId, branchName, production=false, runtime y owner. No usa archivos de credenciales ni ejecuta migraciones.
