import { createClient } from '@supabase/supabase-js'

const supabaseUrl =  import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey =  import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase env vars missing', { url: supabaseUrl, key: !!supabaseAnonKey })
  throw new Error('Missing Supabase environment variables')
}

console.log('✅ Supabase Client Initialized', { url: supabaseUrl })

// Create a single supabase client for interacting with your database
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
