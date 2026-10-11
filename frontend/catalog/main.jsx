import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import ConfigProvider from 'antd/es/config-provider';
import Select from 'antd/es/select';
import Input from 'antd/es/input';
import AutoComplete from 'antd/es/auto-complete';
import Button from 'antd/es/button';
import esES from 'antd/locale/es_ES';
import { normalize, requestCatalog, uniqueNames, optionsFor } from './catalogClient';
import './style.css';
import ReceptionFields from './ReceptionFields';
import '../ui/feedback';
import { allfixTheme } from '../ui/theme';

const EMPTY_CATALOG = { tipos: [], marcas: [], fallas: [], reparaciones: [], relaciones: [], puede_guardar: false };
const emptyValues = () => ({ deviceType: '', brand: '', model: '', fallas: [], reparaciones: [] });
const fieldIds = { deviceType: 'quick-device', brand: 'quick-brand', model: 'quick-model', fallas: 'quick-fault', reparaciones: 'quick-repair' };
const slots = {};
for (const [field, id] of Object.entries(fieldIds)) {
  const original = document.getElementById(id);
  const slot = document.createElement('div');
  slot.className = 'smart-catalog-field';
  original.before(slot);
  const hidden = document.createElement('input');
  hidden.type = 'hidden'; hidden.id = id; hidden.value = original.value;
  original.replaceWith(hidden);
  document.querySelector(`label[for="${id}"]`)?.setAttribute('for', `smart-${field}`);
  slots[field] = slot;
}
document.getElementById('quick-brands')?.remove();
const root = document.createElement('div');
root.id = 'quick-catalog-root';
document.getElementById('quick-order-submit').before(root);

function SingleSelector({ field, value, rows, onChange, label, disabled, onSearch }) {
  const options = uniqueNames(rows).map(row => ({ value: row.nombre, label: row.nombre }));
  return <AutoComplete id={`smart-${field}`} value={value} options={options} disabled={disabled} allowClear
    defaultActiveFirstOption={false}
    filterOption={(input, option) => normalize(option.value).includes(normalize(input))}
    onChange={next => { onChange(next); onSearch?.(next); }}
    getPopupContainer={trigger => trigger.parentElement}>
    <Input id={`smart-${field}`} maxLength={field === 'deviceType' ? 50 : 100}
      placeholder={`Buscar o escribir ${label.toLowerCase()}`}
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
  </AutoComplete>;
}

function MultiSelector({ field, value, rows, onChange, suggested, disabled }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const options = uniqueNames(rows).map(row => ({ value: row.nombre, label: `${row.nombre}${suggested?.has(row.id) ? ' · Sugerida' : ''}`, search: row.nombre }));
  return <Select ref={ref} id={`smart-${field}`} mode="tags" value={value} showSearch searchValue={search}
    open={open} onOpenChange={setOpen}
    disabled={disabled} maxCount={20} options={options} onSearch={text => { setSearch(text); setOpen(true); }}
    onChange={next => { onChange([...new Set(next.map(text => text.trim()).filter(Boolean))]); setSearch(''); setOpen(false); }}
    onInputKeyDown={event => { if (event.key === 'Enter') event.stopPropagation(); if (event.key === 'Tab' || event.key === 'Escape') setOpen(false); }}
    filterOption={(input, option) => normalize(option.search || option.value).includes(normalize(input))}
    placeholder="Buscar o escribir y pulsar Enter" getPopupContainer={trigger => trigger.parentElement}
    popupRender={menu => <>{menu}<Button type="text" block tabIndex={-1} onMouseDown={event => event.preventDefault()}
      onClick={() => { setOpen(false); ref.current?.focus(); }}>+ Otro / Escribir manualmente</Button></>}
  />;
}

function CatalogFields() {
  const [values, setValues] = useState(emptyValues);
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [models, setModels] = useState([]);
  const [modelSearch, setModelSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (message) window.AllfixUI.notify(message, 'warning'); }, [message]);
  const [generation, setGeneration] = useState(0);
  const state = useRef();
  const reception = useRef({});
  const receiveReception = useRef(data => { reception.current = data; }).current;
  const derived = optionsFor(catalog, values);
  const change = (field, value) => {
    setMessage('');
    setValues(old => {
      if (old[field] === value) return old;
      if (field === 'deviceType') { setModels([]); setModelSearch(''); return { ...emptyValues(), deviceType: value }; }
      if (field === 'brand') { setModels([]); setModelSearch(''); return { ...old, brand: value, model: '' }; }
      return { ...old, [field]: value };
    });
  };
  useEffect(() => {
    if (!generation) return;
    const controller = new AbortController();
    setLoading(true); setCatalog(EMPTY_CATALOG);
    requestCatalog('', controller.signal).then(setCatalog).catch(error => {
      if (error.name !== 'AbortError') setMessage(error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [generation]);
  useEffect(() => {
    const controller = new AbortController();
    setModels([]); setModelLoading(false);
    if (!derived.brand) return () => controller.abort();
    setModelLoading(true);
    const timer = setTimeout(() => requestCatalog(`/modelos?marca_id=${derived.brand.id}&q=${encodeURIComponent(modelSearch)}`, controller.signal)
      .then(rows => { if (!controller.signal.aborted) setModels(rows); })
      .catch(error => { if (error.name !== 'AbortError') setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setModelLoading(false); }), 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [derived.brand?.id, modelSearch, generation]);
  useLayoutEffect(() => {
    state.current = { values, save: catalog.puede_guardar };
    for (const [field, id] of Object.entries(fieldIds)) document.getElementById(id).value = Array.isArray(values[field]) ? values[field].join('\n') : values[field];
  }, [values, catalog.puede_guardar]);
  useLayoutEffect(() => {
    globalThis.quickCatalog = {
      reset() { setValues(emptyValues()); setCatalog(EMPTY_CATALOG); setModels([]); setModelSearch(''); setMessage(''); setGeneration(value => value + 1); },
      setBusy,
      focusDevice() { document.getElementById('smart-deviceType')?.focus(); },
      validate() {
        const current = state.current.values;
        const fail = (message, field) => {
          window.AllfixUI.notify(message, 'warning');
          const control = document.getElementById(`smart-${field}`);
          control?.focus(); control?.scrollIntoView({ block: 'center' });
          return false;
        };
        const missing = Object.keys(fieldIds).find(field => Array.isArray(current[field]) ? !current[field].length : !current[field].trim());
        if (missing) return fail('Completa equipo, marca, modelo, al menos una falla y una reparación.', missing);
        if ([...current.fallas, ...current.reparaciones].some(text => text.length > 250)) { setMessage('Cada falla o reparación admite máximo 250 caracteres.'); return false; }
        if ([...(reception.current.inspeccion_visual || []), ...(reception.current.accesorios_entregados || [])].some(text => text.length > 250)) { setMessage('Cada detalle de recepción admite máximo 250 caracteres.'); return false; }
        return true;
      },
      payload() { return { fallas: state.current.values.fallas, reparaciones: state.current.values.reparaciones, guardar_catalogo: state.current.save, ...reception.current }; }
    };
    return () => { delete globalThis.quickCatalog; };
  }, []);
  const single = (field, label, rows) => createPortal(<SingleSelector key={`${generation}-${field === 'brand' || field === 'model' ? values.deviceType : ''}-${field === 'model' ? values.brand : ''}`}
    field={field} label={label} value={values[field]} rows={rows} onChange={value => change(field, value)}
    loading={loading} disabled={busy || (field === 'brand' && !values.deviceType)} />, slots[field]);
  return <ConfigProvider locale={esES} theme={allfixTheme}>
    {single('deviceType', 'Equipo', catalog.tipos)}
    {single('brand', 'Marca', derived.brands)}
    {createPortal(<ModelSelector key={`${generation}-${values.deviceType}-${values.brand}`} value={values.model} rows={models}
      onChange={value => change('model', value)} loading={modelLoading} disabled={busy || !values.brand} onSearch={setModelSearch} />, slots.model)}
    {createPortal(<MultiSelector key={`${generation}-${values.deviceType}`} field="fallas" value={values.fallas} rows={derived.faults} onChange={value => change('fallas', value)} disabled={busy} />, slots.fallas)}
    {createPortal(<MultiSelector key={`${generation}-${values.deviceType}`} field="reparaciones" value={values.reparaciones} rows={derived.repairs} suggested={derived.suggested} onChange={value => change('reparaciones', value)} disabled={busy} />, slots.reparaciones)}
    {createPortal(<ReceptionFields key={generation} deviceType={values.deviceType} disabled={busy} onChange={receiveReception} MultiSelector={MultiSelector} />, document.getElementById('quick-reception-fields'))}
  </ConfigProvider>;
}

// Remote model search uses the same editable selector without shipping all models.
function ModelSelector({ onSearch, ...props }) {
  return <SingleSelector {...props} onSearch={onSearch} field="model" label="Modelo" />;
}

createRoot(root).render(<CatalogFields />);
