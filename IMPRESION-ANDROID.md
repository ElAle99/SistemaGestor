# Impresión Allfix

El frontend existente utiliza `printerService`. Android envía el ticket rasterizado por ESC/POS; web utiliza el diálogo del navegador. Órdenes, ventas, anticipos, liquidaciones y cortes conservan los formatos actuales, incluidos QR y códigos de barras. No se cambian endpoints ni tablas.

## Generar Android (PowerShell)

Instalar Android Studio, SDK 36 y JDK 21. Publicar primero esta versión del frontend en Railway (incluye `dist/printer-service.js`).

El APK admite Android 8 o posterior. El complemento local `AllfixBluetoothPermissions` solicita ubicación únicamente en Android 8–11 para completar la búsqueda Bluetooth; en Android 12+ el plugin térmico solicita dispositivos cercanos.

```powershell
npm ci
$env:ALLFIX_APP_URL = 'https://TU-INSTALACION.up.railway.app'
npm run android:sync
npm run android:open
# O compilar desde consola con JAVA_HOME y ANDROID_HOME configurados:
cd android
.\gradlew.bat assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Para distribución, generar un APK firmado desde Android Studio; no guardar claves de firma en Git.

Capacitor abre exclusivamente el origen HTTPS configurado, reutilizando la sesión, recursos y API de la aplicación web. Necesita internet; no agrega funcionamiento offline. No configurar dominios ajenos ni comodines de navegación. La URL se incorpora al APK al sincronizar; no contiene credenciales. Sin `ALLFIX_APP_URL`, la compilación local sirve para revisar el empaquetado, no para operar contra Railway.

## Probar

En Android, emparejar la impresora en ajustes si lo requiere. Configuración > Impresoras: buscar, seleccionar nombre/MAC, conectar, elegir 58/80 mm y guardar como predeterminada. El servicio reconecta al imprimir. Probar acentos, QR, barras, ticket largo, corte (solo hardware compatible), permisos denegados, Bluetooth apagado y desconexión durante envío. No se reenvían automáticamente trabajos fallidos: revisar el papel antes de reintentar evita duplicados.

La selección y preferencias se guardan en el dispositivo. La configuración del logo conserva su comportamiento por negocio. La impresión automática de ventas respeta la opción local; una orden nueva conserva sus acciones explícitas de impresión.

## Dependencia nativa

Versiones fijadas: Capacitor 8.5.2 y [`@delicity/capacitor-thermal-printer` 8.3.1](https://github.com/kevinfavv/CapacitorThermalPrinter). El plugin declara compatibilidad con Capacitor 8, Bluetooth Classic/SPP y BLE, y gestiona permisos de Android 12+ y anteriores. Su documentación advierte que sigue en desarrollo: validar cada modelo físico antes de producción. BLE depende de los servicios/características del modelo; no toda impresora Bluetooth implementa ESC/POS. La confirmación de envío no demuestra que el papel haya salido.

QZ Tray ya no se carga ni se instala. Web/PC siempre requiere el diálogo del navegador y los controladores del sistema operativo.

Verificación en este entorno: compilación web, 116 pruebas backend y 15 pruebas de interfaz aprobadas; sincronización Capacitor aprobada. No se generó APK: falta JDK/JAVA_HOME y no se encontró SDK Android instalado. Falta validar una impresora física. `npm audit --omit=dev` detectó una vulnerabilidad moderada en DOMPurify, dependencia existente del generador PDF; no se actualizó ese módulo fuera del alcance de impresión.
