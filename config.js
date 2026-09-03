// Verbindungsdaten für den Browser.
//
// Beide Werte sind öffentlich und gehören genau hierher: Die URL benennt das
// Projekt, der Publishable Key identifiziert es. Was ein Besucher tatsächlich
// lesen oder schreiben darf, entscheidet ausschließlich Supabase Auth zusammen
// mit den Row-Level-Security-Policies auf den Tabellen.
//
// Der Service-Role-Key umgeht diese Policies vollständig. Er gehört in die
// Supabase-Secrets der Edge Function und niemals in eine Datei, die der Browser
// lädt — dieses Repository ist öffentlich.
//
// Den Publishable Key findest du unter:
// Project Settings → API Keys → "Publishable key" (beginnt mit sb_publishable_)

export const SUPABASE_URL = "https://pdobcvffnzqxtmkkpfnn.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nGUTKEdAuo_87z38unJZcA_nKnsQIHC";
