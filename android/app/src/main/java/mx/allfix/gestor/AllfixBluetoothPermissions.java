package mx.allfix.gestor;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Discovery requires location on Android 8–11; Android 12+ uses nearby devices. */
@CapacitorPlugin(name = "AllfixBluetoothPermissions", permissions = {
    @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION})
})
public class AllfixBluetoothPermissions extends Plugin {
    @PluginMethod
    public void ensureDiscovery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "discoveryPermissionResult");
        } else {
            discoveryPermissionResult(call);
        }
    }

    @PermissionCallback
    private void discoveryPermissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S || getPermissionState("location") == PermissionState.GRANTED);
        call.resolve(result);
    }
}
