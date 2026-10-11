package mx.allfix.gestor;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AllfixBluetoothPermissions.class);
        super.onCreate(savedInstanceState);
    }
}
