-- Krea 2 Medium Turbo becomes the default cloud image model, replacing Nano Banana 2 Lite.
--
-- Krea produces better characters and backgrounds, but it does not honour reference images: it
-- accepts them, returns 200, and ignores them (measured 2026-07-31). Anything that must stay
-- consistent with an image we already have (visual-novel
-- avatars, cutscenes, battle maps drawn from a location background, and image-to-image edits)
-- therefore keeps requesting Nano Banana 2 Lite explicitly - see features/image/api/generate-image.ts
-- and features/guide/api/images.ts. This default only governs requests that carry no references.
--
-- Existing rows that still hold the old default are moved with it; a row whose owner picked some
-- other image model in Settings is left alone.

alter table user_settings alter column image_model set default 'krea/krea-2-medium-turbo';

update user_settings
   set image_model = 'krea/krea-2-medium-turbo'
 where image_model = 'google/gemini-3.1-flash-lite-image';
