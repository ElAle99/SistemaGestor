import React, { useLayoutEffect, useRef, useState } from 'react';
import Input from 'antd/es/input';
import Alert from 'antd/es/alert';
import { receptionOptions } from './receptionOptions';

export default function ReceptionFields({ deviceType, disabled, onChange, MultiSelector }) {
  const [inspection, setInspection] = useState([]);
  const [accessories, setAccessories] = useState([]);
  const [otherInspection, setOtherInspection] = useState('');
  const [otherAccessories, setOtherAccessories] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const previousType = useRef(deviceType);
  const options = receptionOptions(deviceType);
  useLayoutEffect(() => {
    if (previousType.current !== deviceType && (inspection.length || accessories.length)) {
      setNotice('Cambió el equipo. Conservamos la inspección y los accesorios seleccionados; revísalos antes de guardar.');
    }
    previousType.current = deviceType;
  }, [deviceType, inspection.length, accessories.length]);
  const resolveOther = (values, other) => values.map(value => value === 'Otro' && other.trim() ? `Otro: ${other.trim()}` : value);
  useLayoutEffect(() => {
    onChange({ inspeccion_visual: resolveOther(inspection, otherInspection), accesorios_entregados: resolveOther(accessories, otherAccessories), nota_recepcion: note });
  }, [inspection, accessories, otherInspection, otherAccessories, note, onChange]);
  const rows = values => values.map(nombre => ({ nombre }));
  return <>
    <div className="quick-order-grid">
      <div className="form-group quick-order-wide smart-catalog-field">
        <label htmlFor="smart-inspeccion">Inspección visual</label>
        <MultiSelector field="inspeccion" value={inspection} rows={rows(options.inspection)} onChange={setInspection} disabled={disabled} />
        {inspection.includes('Otro') && <Input className="quick-reception-other" aria-label="Otra inspección visual" placeholder="Describe otro detalle visual" value={otherInspection} maxLength={244} onChange={event => setOtherInspection(event.target.value)} disabled={disabled} />}
      </div>
      <div className="form-group quick-order-wide smart-catalog-field">
        <label htmlFor="smart-accesorios">Accesorios entregados</label>
        <MultiSelector field="accesorios" value={accessories} rows={rows(options.accessories)} onChange={setAccessories} disabled={disabled} />
        {accessories.includes('Otro') && <Input className="quick-reception-other" aria-label="Otro accesorio" placeholder="Describe otro accesorio" value={otherAccessories} maxLength={244} onChange={event => setOtherAccessories(event.target.value)} disabled={disabled} />}
      </div>
      <div className="form-group quick-order-wide">
        <label htmlFor="quick-reception-note">Nota de recepción</label>
        <Input.TextArea id="quick-reception-note" value={note} maxLength={2000} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="Ej. Equipo recibido sin bandeja SIM, tapa trasera despegada..." onChange={event => setNote(event.target.value)} disabled={disabled} />
      </div>
    </div>
    {notice && <Alert className="quick-reception-notice" type="info" message={notice} showIcon />}
  </>;
}
