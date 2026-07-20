-- Encounter-states Slice 7: minimal retrieval memory. Encounter resolutions and scene
-- summaries get embedded (1024-dim, see _shared/llm.ts EMBEDDING_MODEL) and retrieved top-K
-- at prompt assembly for the Narrator (exposition), NPC bundle, and Beat Planner.
create extension if not exists vector;

create table public.memory_fragments (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references public.adventures(id) on delete cascade,
  kind text not null check (kind in ('encounter', 'scene_summary')),
  content text not null,
  embedding vector(1024) not null,
  created_at timestamptz not null default now()
);

create index memory_fragments_adventure_idx on public.memory_fragments (adventure_id);
create index memory_fragments_embedding_idx on public.memory_fragments
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Service-role only (the session function writes and reads); no client policies.
alter table public.memory_fragments enable row level security;

create or replace function public.match_memory_fragments(
  p_adventure_id uuid,
  p_query vector(1024),
  p_k int default 4
)
returns table (id uuid, kind text, content text, similarity double precision)
language sql stable
as $$
  select mf.id, mf.kind, mf.content, 1 - (mf.embedding <=> p_query) as similarity
  from public.memory_fragments mf
  where mf.adventure_id = p_adventure_id
  order by mf.embedding <=> p_query
  limit greatest(1, p_k)
$$;
