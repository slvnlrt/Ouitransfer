export interface GenerateInviteTokenRequest {
  /** If provided, the invite link is also emailed to this address. */
  email?: string;
}

export interface GenerateInviteTokenResponse {
  token: string;
  expiresAt: string;
  emailSent: boolean;
  /**
   * Absolute self-registration URL built from the server-configured appUrl, or
   * null when appUrl is unset (the client then falls back to its own origin).
   */
  registrationUrl: string | null;
}

export interface ValidateInviteTokenResponse {
  valid: boolean;
  used?: boolean;
  expired?: boolean;
}

export interface RegisterWithInviteRequest {
  token: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
}

export interface RegisterWithInviteResponse {
  message: string;
  user: {
    id: string;
    username: string;
    email: string;
  };
}
