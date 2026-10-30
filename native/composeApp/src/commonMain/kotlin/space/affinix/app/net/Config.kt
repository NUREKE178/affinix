package space.affinix.app.net

/**
 * Where the app talks to. The Supabase publishable (anon) key is public by design: it is the same value the website ships in
 * src/lib/env.js, and Row Level Security is what protects the data.
 */
data class Config(
    val supabaseUrl: String = "https://kjqqqovjapmktpdvfbyv.supabase.co",
    val anonKey: String = "sb_publishable_H4xVnt5vUDnQR4GTGq8rGA_nLqsWga_",
    /** Base of the Vercel functions that deal duels and render specimens (api/arena-deal, api/arena-specimen). */
    val apiBase: String = "https://affinix.space",
)
