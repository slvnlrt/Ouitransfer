"use client";

import { Download, Maximize, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button } from "@/components/ui/button";

interface ImagePreviewProps {
  src: string;
  alt: string;
  description?: string;
  onDownload?: () => void;
}

export function ImagePreview({ src, alt, description, onDownload }: ImagePreviewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleExpandClick = () => {
    setIsFullscreen(true);
  };

  const handleCloseFullscreen = () => {
    setIsFullscreen(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsFullscreen(false);
    }
  };

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
    } else {
      const link = document.createElement("a");
      link.href = src;
      link.download = alt;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isFullscreen]);

  return (
    <>
      <AspectRatio ratio={16 / 9} className="bg-muted">
        <div className="relative group w-full h-full">
          <Image
            src={src}
            alt={alt}
            fill
            className="object-contain rounded-md cursor-pointer"
            onClick={handleExpandClick}
            unoptimized
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300 rounded-md">
            <Button
              variant="outline"
              size="icon"
              className="absolute bottom-2 end-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-white/90 hover:bg-white text-black shadow-lg h-8 w-8"
              onClick={handleExpandClick}
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </AspectRatio>

      {isFullscreen &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-sm"
            aria-hidden="true"
            onClick={handleBackdropClick}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCloseFullscreen();
            }}
            style={{ margin: 0, padding: 0 }}
          >
            <div className="fixed top-0 start-0 end-0 bg-transparent h-24 z-[100000] pointer-events-none">
              <div className="absolute top-6 end-6 flex gap-2 pointer-events-auto">
                <Button
                  variant="outline"
                  size="icon"
                  className="cursor-pointer bg-white/10 hover:bg-white/20 text-white border-white/20 h-10 w-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload();
                  }}
                >
                  <Download className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="cursor-pointer bg-white/10 hover:bg-white/20 text-white border-white/20 h-10 w-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseFullscreen();
                  }}
                >
                  <X className="h-6 w-6" />
                </Button>
              </div>
            </div>

            <div className="fixed inset-0 flex items-center justify-center pt-6 pb-12">
              <div className="relative w-full h-full">
                <Image
                  src={src}
                  alt={alt}
                  fill
                  className="object-contain"
                  onClick={(e) => e.stopPropagation()}
                  unoptimized
                />
              </div>
            </div>

            <div className="fixed bottom-0 start-0 end-0 z-[100000] pointer-events-none">
              (
              <div className="absolute bottom-0 start-0 end-0 p-6">
                <div className="text-white/30">
                  <span className=" font-semibold mb-2 truncate">{alt}</span>
                  {description && (
                    <p className="text-sm text-gray-200/20 line-clamp-2">{description}</p>
                  )}
                </div>
              </div>
              );
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
