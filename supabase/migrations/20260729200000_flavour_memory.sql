-- A place for what the NARRATOR invented (owner direction, 2026-07-29).
--
-- The problem this closes: items shipped earlier today give the narrator the AUTHORED record to
-- read - node outcome summaries, location features - but nothing captures what it makes up itself.
-- In run bac9f4b9 it introduced an alleyway, an obsidian shard in Dermot's pouch and a magistrate's
-- notice on a gate. None are in the guide, none were written anywhere, so two turns later they were
-- dropped or re-invented differently. That is the residual contradiction engine.
--
-- The design: inventions ARE recorded, as a second tier of canon - referenceable so the world stays
-- consistent, but explicitly flavour, never plot. Two properties make that safe, and both already
-- hold:
--
--   1. `memory_fragments` has NO PATH TO STATE. It is retrieved as prose into a prompt and nothing
--      else; `applyMilestones` is the only writer of flags and facts and it validates against the
--      authored vocabulary. So a flavour memory cannot advance, block or destroy the plot by
--      construction rather than by rule.
--   2. Since the decoupling earlier today, the plot advances only when an authored node RESOLVES.
--      Before that, prose could reach canon - the ledger once promoted "she turns away" into a
--      durable `absent` and deleted an objective's whole cast. The fallback rails are what make a
--      free-inventing narrator affordable.
alter table public.memory_fragments drop constraint if exists memory_fragments_kind_check;
alter table public.memory_fragments
  add constraint memory_fragments_kind_check
  check (kind in ('encounter', 'scene_summary', 'flavour'));

comment on column public.memory_fragments.kind is
  'encounter | scene_summary = the authored spine''s own record, written when a phase closes. '
  'flavour = detail the NARRATOR introduced, recorded so it stays consistent and labelled so '
  'nothing downstream treats it as plot. See docs/DECISIONS.md 2026-07-29.';

-- Retrieval needs to be able to ask for ONE tier.
--
-- `match_memory_fragments` takes a top-K across every fragment. Flavour is written per narration
-- rather than per phase - roughly ten times as often - so sharing one budget would let colour crowd
-- out the spine memories that slot exists for. The kinds are retrieved separately, into separately
-- labelled blocks, so the narrator can tell "this happened" from "you said this once".
create or replace function public.match_memory_fragments_kind(
  p_adventure_id uuid,
  p_query vector(1024),
  p_kinds text[],
  p_k int default 4
)
returns table (id uuid, kind text, content text, similarity double precision)
language sql stable as $$
  select mf.id, mf.kind, mf.content, 1 - (mf.embedding <=> p_query) as similarity
  from public.memory_fragments mf
  where mf.adventure_id = p_adventure_id
    and mf.kind = any(p_kinds)
  order by mf.embedding <=> p_query
  limit greatest(1, p_k)
$$;
