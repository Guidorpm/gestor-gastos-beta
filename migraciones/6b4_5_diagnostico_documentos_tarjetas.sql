-- =====================================================================
-- DIAGNÓSTICO 6B4.5 — Documentos de tarjetas (SOLO LECTURA)
-- ---------------------------------------------------------------------
-- Uso: ejecutar manualmente y a mano en el SQL editor de Supabase para
-- investigar por qué resúmenes ya subidos figuran "Sin cargar".
-- Este archivo contiene EXCLUSIVAMENTE sentencias SELECT. No modifica
-- ni borra nada. No se ejecuta automáticamente desde la aplicación.
-- =====================================================================

-- 1) Cantidad total de documentos de tipo 'statement' (resumen original)
select count(*) as total_documentos_statement
from public.documents
where kind = 'statement';

-- 2) Documentos de tarjeta agrupados por card_id + statement_id
select card_id, statement_id, kind, count(*) as cantidad
from public.documents
where card_id is not null
group by card_id, statement_id, kind
order by card_id, statement_id;

-- 3) Documentos de tarjeta SIN statement_id (podrían no aparecer en ningún resumen)
select id, card_id, statement_id, movement_id, kind, file_path, original_name, uploaded_by, created_at
from public.documents
where card_id is not null
  and statement_id is null
order by created_at desc;

-- 4) Documentos con card_id pero sin statement_id, específicamente de tipo 'statement'
--    (estos son los candidatos más probables al problema reportado: el
--    archivo se subió pero quedó sin vincular al resumen correcto)
select id, card_id, statement_id, kind, file_path, original_name, uploaded_by, created_at
from public.documents
where card_id is not null
  and statement_id is null
  and kind = 'statement'
order by created_at desc;

-- 5) Documentos de tarjeta creados más recientemente (para ubicar la carga masiva reciente)
select id, card_id, statement_id, movement_id, kind, file_path, original_name, size_bytes, uploaded_by, created_at
from public.documents
where card_id is not null
order by created_at desc
limit 50;

-- 6) Posibles duplicados: más de un documento 'statement' para el mismo statement_id
select statement_id, kind, count(*) as cantidad
from public.documents
where card_id is not null
  and statement_id is not null
group by statement_id, kind
having count(*) > 1
order by cantidad desc;

-- 7) Confirmación de que los documentos de Servicios (facturas/comprobantes) siguen presentes
select kind, count(*) as cantidad
from public.documents
where group_id is not null
group by kind
order by kind;

-- 8) Resumen cruzado: para cada resumen de tarjeta, indica si tiene o no
--    un documento 'statement' vinculado (ayuda a contar cuántos siguen
--    realmente sin cargar vs. cuántos ya tienen fila en documents)
select
  s.id as statement_id,
  s.card_id,
  s.statement_month,
  (
    select count(*)
    from public.documents d
    where d.statement_id = s.id and d.kind = 'statement'
  ) as documentos_statement_vinculados
from public.credit_card_statements s
order by s.card_id, s.statement_month desc;
