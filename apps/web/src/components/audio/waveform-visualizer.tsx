import { useTranslations } from "next-intl";

import { Slider } from "@/components/ui/slider";

interface WaveformVisualizerProps {
  progress: number;
  onSeek: (value: number[]) => void;
  audioData?: Float32Array | null;
  isLoading?: boolean;
}

export function WaveformVisualizer({
  progress,
  onSeek,
  audioData,
  isLoading = false,
}: WaveformVisualizerProps) {
  const t = useTranslations();

  const generateMockWaveform = () => {
    return Array.from({ length: 200 }, (_, i) => {
      const baseHeight = Math.sin(i * 0.1) * 30 + 40;
      const variation = Math.sin(i * 0.3) * 20;
      return baseHeight + variation;
    });
  };

  const generateRealWaveform = () => {
    if (!audioData) return generateMockWaveform();

    return Array.from(audioData, (value) => {
      const normalizedHeight = Math.max(15, value * 100 + 20);
      return normalizedHeight;
    });
  };

  const waveformData = audioData ? generateRealWaveform() : generateMockWaveform();

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = (clickX / rect.width) * 100;
    onSeek([percentage]);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      onSeek([Math.min(100, progress + 5)]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      onSeek([Math.max(0, progress - 5)]);
    } else if (event.key === "Home") {
      onSeek([0]);
    } else if (event.key === "End") {
      onSeek([100]);
    }
  };

  if (isLoading) {
    return (
      <div className="relative">
        <div className="flex items-center justify-center h-24 bg-muted rounded-md">
          <div className="animate-pulse text-muted-foreground">{t("filePreview.loadingAudio")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        className="hidden sm:flex items-end justify-center h-24 gap-[2px] cursor-pointer rounded-md"
        role="slider"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {waveformData.map((height, index) => {
          const isActive = (index / waveformData.length) * 100 <= progress;
          return (
            <div
              key={index}
              className={`w-[2px] rounded-sm transition-all duration-150 ${
                isActive ? "bg-primary" : "bg-muted-foreground/20"
              }`}
              style={{
                height: `${height}%`,
                minHeight: "2px",
              }}
            />
          );
        })}
      </div>

      <div className="sm:hidden w-full py-8">
        <Slider value={[progress]} onValueChange={onSeek} max={100} step={0.1} className="w-full" />
      </div>
    </div>
  );
}
