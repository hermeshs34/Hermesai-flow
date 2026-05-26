import { createClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para conectar con base de datos real
 * Configurar variables de entorno:
 * VITE_SUPABASE_URL: https://your-project.supabase.co
 * VITE_SUPABASE_ANON_KEY: tu anon key
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabase: ReturnType<typeof createClient> | null = null;

/**
 * Obtener instancia de Supabase (lazy initialization)
 */
export function getSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      'Supabase no está configurado. Usando almacenamiento en memoria. ' +
      'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env'
    );
    return null;
  }

  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }

  return supabase;
}

/**
 * Verificar si Supabase está disponible
 */
export function isSupabaseConfigured(): boolean {
  return !!supabaseUrl && !!supabaseAnonKey;
}
