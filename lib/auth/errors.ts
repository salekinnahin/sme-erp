import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

const GENERIC = "Something went wrong. Please try again.";

/** Maps Supabase auth errors to safe, user-facing messages. */
export function friendlyAuthError(error: unknown): string {
  if (isAuthRetryableFetchError(error)) {
    return "Could not reach the authentication service. Check your connection and try again.";
  }
  if (!isAuthError(error)) return GENERIC;

  switch (error.code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Please confirm your email address before signing in. Check your inbox for the confirmation link.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Try signing in instead.";
    case "weak_password":
      return "That password is too weak. Use at least 8 characters with a mix of letters, numbers and symbols.";
    case "email_address_invalid":
      return "Please enter a valid email address.";
    case "signup_disabled":
      return "New sign-ups are currently disabled.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return GENERIC;
  }
}
