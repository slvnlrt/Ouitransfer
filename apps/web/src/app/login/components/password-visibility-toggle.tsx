import { Eye, EyeClosed } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PasswordVisibilityToggleProps {
  isVisible: boolean;
  onToggle: () => void;
}

export function PasswordVisibilityToggle({ isVisible, onToggle }: PasswordVisibilityToggleProps) {
  return (
    <Button
      type="button"
      variant="link"
      onClick={onToggle}
      className="absolute end-0 top-1/2 -translate-y-1/2 cursor-pointer"
    >
      {isVisible ? (
        <Eye className="h-5 w-5 text-muted-foreground" />
      ) : (
        <EyeClosed className="h-5 w-5 text-muted-foreground" />
      )}
    </Button>
  );
}
