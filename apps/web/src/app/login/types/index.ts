import type { UseFormReturn } from "react-hook-form";

import type { LoginFormData } from "../hooks/use-login";

export interface LoginFormProps {
  form: UseFormReturn<LoginFormData>;
  error: string | null;
  isVisible: boolean;
  onToggleVisibility: () => void;
  onSubmit: (data: LoginFormData) => Promise<void>;
}
