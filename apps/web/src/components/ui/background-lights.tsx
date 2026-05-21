/**
 * BackgroundLights — decorative radial gradient blobs for public/auth pages.
 *
 * Server Component (no animations, no client-side JS). Static CSS opacity is
 * reliable across all environments including Docker production builds.
 */
export function BackgroundLights() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      {/* Primary indigo blob — top left */}
      <div
        className="absolute -top-[30%] -start-[20%] w-[80%] h-[80%] opacity-25 dark:opacity-40"
        style={{
          background: `radial-gradient(ellipse at center, oklch(from var(--primary) l c h / 0.12) 0%, transparent 70%)`,
        }}
      />
      {/* Secondary deeper blob — bottom right */}
      <div
        className="absolute -bottom-[20%] -end-[10%] w-[70%] h-[70%] opacity-20 dark:opacity-30"
        style={{
          background: `radial-gradient(ellipse at center, oklch(from var(--primary) calc(l - 0.1) c h / 0.1) 0%, transparent 65%)`,
        }}
      />
      {/* Warm accent glow — center, very subtle */}
      <div
        className="absolute top-[20%] start-[30%] w-[50%] h-[50%] opacity-[0.08] dark:opacity-[0.15]"
        style={{
          background: `radial-gradient(ellipse at center, oklch(0.75 0.12 75 / 0.08) 0%, transparent 60%)`,
        }}
      />
    </div>
  );
}
