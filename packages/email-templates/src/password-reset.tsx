import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { PasswordResetProps } from "./prop-schemas";

/**
 * Password-reset email. Same layout discipline as verify-email:
 * inline styles, no images, one CTA plus a plain-text link. `resetUrl`
 * is pre-sanitized upstream. `expiresIn` is a human-facing string
 * (e.g., "1 hour") — the auth service formats it; no time math here.
 */
export function PasswordReset({ userName, resetUrl, expiresIn }: PasswordResetProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your Runway password. This link expires in {expiresIn}.</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Reset your password</Heading>
          <Text style={textStyle}>Hi {userName},</Text>
          <Text style={textStyle}>
            Someone (hopefully you) asked to reset the password on this account.
            Tap the button below to pick a new one. The link expires in {expiresIn}.
          </Text>
          <Section style={buttonSectionStyle}>
            <Button href={resetUrl} style={buttonStyle}>
              Reset password
            </Button>
          </Section>
          <Text style={mutedTextStyle}>
            Or paste this URL into your browser:{" "}
            <Link href={resetUrl} style={linkStyle}>
              {resetUrl}
            </Link>
          </Text>
          <Text style={mutedTextStyle}>
            If you didn&apos;t request a reset, ignore this email — your password
            hasn&apos;t changed.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const PASSWORD_RESET_SUBJECT = "Reset your Runway password";

const bodyStyle = { backgroundColor: "#f6f9fc", fontFamily: "sans-serif" };
const containerStyle = {
  backgroundColor: "#ffffff",
  margin: "40px auto",
  padding: "32px",
  maxWidth: "560px",
  borderRadius: "8px",
};
const headingStyle = { fontSize: "22px", margin: "0 0 16px" };
const textStyle = { fontSize: "15px", lineHeight: "22px", color: "#1f2937" };
const mutedTextStyle = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#6b7280",
  marginTop: "16px",
};
const buttonSectionStyle = { textAlign: "center" as const, margin: "24px 0" };
const buttonStyle = {
  backgroundColor: "#1f2937",
  color: "#ffffff",
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: 600,
};
const linkStyle = { color: "#1f2937", wordBreak: "break-all" as const };
