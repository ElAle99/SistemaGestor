CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE FUNCTION auth_login(login TEXT, secret TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',id,'username',username,'rol',rol,'activo',activo,'session_version',session_version,'negocio_id',negocio_id,'nombre',nombre,'correo',correo,'telefono',telefono)
 FROM public.usuarios WHERE lower(username)=lower(login) AND activo=true
 AND public.crypt(secret,regexp_replace(password,'^\$2b\$','$2a$'))=regexp_replace(password,'^\$2b\$','$2a$') LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_login(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login(TEXT,TEXT) TO sistema_gestor_app;
DROP FUNCTION auth_user_by_username(TEXT);
CREATE FUNCTION public_order_status(requested_folio TEXT) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('folio',o.folio,'status',o.estado,'estado_actual',o.estado,
 'deviceType',o.tipo_equipo,'equipo',o.tipo_equipo,'brand',o.marca,'marca',o.marca,'model',o.modelo,'modelo',o.modelo,
 'dateIn',o.fecha_creacion,'fecha_ingreso',o.fecha_creacion,'estimatedDate',o.fecha_entrega_estimada,'fecha_estimada',o.fecha_entrega_estimada,
 'tecnicoAsignado',u.nombre,'tecnico_asignado',u.nombre,
 'historial',COALESCE((SELECT jsonb_agg(jsonb_build_object('estado',h.estado,'fecha',h.fecha,'comentario',h.comentario) ORDER BY h.id) FROM public.historial_estados h WHERE h.orden_id=o.id AND h.negocio_id=o.negocio_id),'[]'::jsonb),
 'publicRemarks',(SELECT comentario FROM public.historial_estados h WHERE h.orden_id=o.id AND h.negocio_id=o.negocio_id ORDER BY h.id DESC LIMIT 1),
 'evidencias','[]'::jsonb,'evidenciasPorEstado','[]'::jsonb)
 FROM public.ordenes_servicio o LEFT JOIN public.usuarios u ON u.id=o.tecnico_id AND u.negocio_id=o.negocio_id WHERE o.folio=requested_folio;
$$;
REVOKE ALL ON FUNCTION public_order_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_order_status(TEXT) TO sistema_gestor_app;
CREATE OR REPLACE FUNCTION public_logo(file_url TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.archivos a JOIN public.negocio_logos l ON l.url=a.url AND l.negocio_id=a.negocio_id
 WHERE a.url=file_url AND a.publico=true
 AND NOT EXISTS(SELECT 1 FROM public.evidencias_orden e WHERE e.archivo_url=a.url)
 AND NOT EXISTS(SELECT 1 FROM public.fotos_garantia f WHERE f.archivo_url=a.url));
$$;
INSERT INTO tenant_migraciones(version) VALUES('20261014-v4');
