"use client";

import { FlaskConical } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const V1_BETA_MODAL_KEY = "OUITRANSFER-v1-beta-modal-shown";

export function V1BetaModal() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Show once when visiting the v1-beta docs for the first time
    if (pathname?.includes("/docs/v1-beta")) {
      const hasSeenModal = localStorage.getItem(V1_BETA_MODAL_KEY);

      if (!hasSeenModal) {
        setIsOpen(true);
      }
    }
  }, [pathname]);

  const handleClose = () => {
    localStorage.setItem(V1_BETA_MODAL_KEY, "true");
    setIsOpen(false);
  };

  const handleGoToQuickStart = () => {
    handleClose();
    router.push("/docs/v1-beta/quick-start");
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[600px] max-w-[90vw] sm:max-w-[600px] border-2 border-indigo-400 shadow-2xl backdrop-blur-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2">
              <FlaskConical className="h-8 w-8 text-indigo-500" />
            </div>
            <DialogTitle className="text-xl font-bold">Welcome to v1-beta</DialogTitle>
          </div>
          <DialogDescription className="text-left space-y-4 pt-2 text-base leading-relaxed">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 mb-4">
              <p className="text-indigo-800 dark:text-indigo-200 text-sm font-medium">
                <strong>Note:</strong> OUITRANSFER. is currently in beta. Features may evolve and
                some rough edges may remain. Your feedback helps us improve.
              </p>
            </div>
            <p>
              This is the first public release of{" "}
              <strong className="text-indigo-600">OUITRANSFER.</strong> — a self-hosted, open-source
              file transfer platform built for speed, privacy, and simplicity.
            </p>
            <p>
              Found a bug or have a suggestion? Open an issue on{" "}
              <a
                href="https://github.com/burger-cie/ouitransfer"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 underline underline-offset-2"
              >
                GitHub
              </a>
              .
            </p>
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 justify-end pt-6">
          <Button onClick={handleClose} className="px-6">
            Got it
          </Button>
          <Button onClick={handleGoToQuickStart} className="px-6">
            Get Started
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
