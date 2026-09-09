export interface AuthEvidence {
  // One authenticated request's headers. Values are used ONLY to match against storage; they are
  // never copied into the output.
  requestHeaders: Record<string, string>
  localStorage?: Record<string, string>
  sessionStorage?: Record<string, string>
  cookies?: Record<string, string>
}
