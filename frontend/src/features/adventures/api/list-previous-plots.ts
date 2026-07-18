import { supabase } from '@/lib/supabase'

// "Previous ideas" dropdown source (F03 SS3.4): distinct plot texts from the user's other
// adventures. RLS already scopes the select to the current user's rows.
export async function listPreviousPlots(excludeAdventureId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('adventures')
    .select('plot_idea')
    .neq('id', excludeAdventureId)
    .neq('plot_idea', '')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  const plots = (data as { plot_idea: string }[]).map((row) => row.plot_idea)
  return [...new Set(plots)]
}
