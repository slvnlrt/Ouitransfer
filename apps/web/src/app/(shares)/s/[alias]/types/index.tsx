import type { Share } from "@/http/endpoints/shares/types";

export interface PasswordModalProps {
  isOpen: boolean;
  password: string;
  isError: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: () => Promise<void>;
}

export interface ShareDetailsProps {
  share: Share;
  password?: string;
  onDownload: (objectName: string, fileName: string) => Promise<void>;
  onBulkDownload?: () => Promise<void>;
}
