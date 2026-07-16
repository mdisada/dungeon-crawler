-- Phase 0: enable extensions required by later migrations.
-- pgvector backs the Memory & RAG embedding columns (MAIN-SPEC.md SS7.2, F13).
create extension if not exists vector with schema extensions;
