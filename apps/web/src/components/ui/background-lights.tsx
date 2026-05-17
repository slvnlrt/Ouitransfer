"use client";

import { motion } from "motion/react";

export function BackgroundLights() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      {/* Primary indigo blob — top left */}
      <motion.div
        animate={{
          x: [0, 30, 0],
          y: [0, -20, 0],
          opacity: [0.25, 0.4, 0.25],
        }}
        className="absolute -top-[30%] -start-[20%] w-[80%] h-[80%]"
        style={{
          background: `radial-gradient(ellipse at center, oklch(from var(--primary) l c h / 0.12) 0%, transparent 70%)`,
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      {/* Secondary deeper blob — bottom right */}
      <motion.div
        animate={{
          x: [0, -20, 0],
          y: [0, 30, 0],
          opacity: [0.2, 0.35, 0.2],
        }}
        className="absolute -bottom-[20%] -end-[10%] w-[70%] h-[70%]"
        style={{
          background: `radial-gradient(ellipse at center, oklch(from var(--primary) calc(l - 0.1) c h / 0.1) 0%, transparent 65%)`,
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 8,
        }}
      />
      {/* Warm accent glow — center, very subtle */}
      <motion.div
        animate={{
          opacity: [0.05, 0.12, 0.05],
        }}
        className="absolute top-[20%] start-[30%] w-[50%] h-[50%]"
        style={{
          background: `radial-gradient(ellipse at center, oklch(0.75 0.12 75 / 0.08) 0%, transparent 60%)`,
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 4,
        }}
      />
    </div>
  );
}
