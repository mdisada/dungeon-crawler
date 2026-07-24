-- Fish Audio becomes the default cloud TTS provider (replacing Voxtral/OpenRouter as the default;
-- Voxtral stays selectable in the Assets Lab). Two changes:
--
-- 1. voice_profiles.fish_reference_id: Fish clones a voice by `reference_id`, which you get by
--    registering the uploaded clip as a Fish "model" once (POST /model, no transcript needed).
--    We cache that id on the profile so the clip is only trained on Fish once, then reused. Null
--    until the profile is first used on the Fish cloud route.
--
-- 2. user_settings.tts_model default flips to 's1' (Fish's flagship engine). Existing rows keep
--    whatever they have; the app's UI writes 's1' going forward. ai-proxy routes a tts request to
--    Fish when the model is a Fish engine id (s1 / s2-pro / s2.1-pro / s2.1-pro-free), else to the
--    OpenRouter audio endpoint as before.

alter table voice_profiles add column fish_reference_id text;

alter table user_settings alter column tts_model set default 's1';
