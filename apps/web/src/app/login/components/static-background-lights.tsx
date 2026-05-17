export function StaticBackgroundLights() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute -top-[30%] -start-[20%] w-[80%] h-[80%] dark:opacity-40 opacity-25"
        style={{
          background: `radial-gradient(ellipse at center, oklch(from var(--primary) l c h / 0.15) 0%, transparent 70%)`,
        }}
      />
      <div
        className="absolute -bottom-[20%] -end-[10%] w-[70%] h-[70%] dark:opacity-30 opacity-20"
        style={{
          background: `radial-gradient(ellipse at center, oklch(from var(--primary) calc(l - 0.1) c h / 0.12) 0%, transparent 65%)`,
        }}
      />
    </div>
  );
}
