-- Map authoring (/maps editor): every battle map now carries its own tile grid, native image
-- size, display fit, and default spawn squares per side -- not just painted obstacles. grid_cols
-- x grid_rows generalizes the old canonical 32x32 assumption (see the combat engine's gridWidth/
-- gridHeight); image_width/height are the uploaded image's intrinsic pixels (used to suggest a
-- grid and warn on aspect mismatch); image_fit is how the image maps onto the grid area; spawns
-- holds two [x,y] cell lists ({party, enemy}), same shape as obstacles.

alter table battle_maps
  add column grid_cols int not null default 32,
  add column grid_rows int not null default 32,
  add column image_width int,
  add column image_height int,
  add column image_fit text not null default 'fill',
  add column spawns jsonb not null default '{"party": [], "enemy": []}'::jsonb;

alter table battle_maps
  add constraint battle_maps_grid_cols_range check (grid_cols between 4 and 128),
  add constraint battle_maps_grid_rows_range check (grid_rows between 4 and 128),
  add constraint battle_maps_image_fit_valid check (image_fit in ('fill', 'cover', 'contain'));
