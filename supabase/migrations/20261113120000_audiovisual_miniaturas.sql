-- Audiovisual: portada (miniatura) de cada video, como avGuardarMiniatura del original.
-- Se guarda la dirección pública de la imagen en el almacenamiento de la app (bucket audiovisual).
-- Las piezas migradas conservan miniatura_id (archivo de Drive).
alter table public.audiovisual add column if not exists miniatura_url text;
