import type { UseFormReturn } from "react-hook-form";

import type { User } from "@/http/endpoints/auth/types";
import type { PasswordFormData, ProfileFormData } from "../hooks/use-profile";

export interface PasswordFormProps {
  form: UseFormReturn<PasswordFormData>;
  isNewPasswordVisible: boolean;
  isConfirmPasswordVisible: boolean;
  onToggleNewPassword: () => void;
  onToggleConfirmPassword: () => void;
  onSubmit: (data: PasswordFormData) => Promise<void>;
}

export interface ProfileFormProps {
  form: UseFormReturn<ProfileFormData>;
  onSubmit: (data: ProfileFormData) => Promise<void>;
}

export interface ProfilePictureProps {
  userData: User | null;
  onImageChange: (file: File) => Promise<void>;
  onImageRemove: () => Promise<void>;
}
