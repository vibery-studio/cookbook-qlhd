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
import type { VerifyEmailProps } from "./prop-schemas";

/**
 * Verification email component. Kept deliberately minimal — inline
 * styles only (no CSS-in-JS runtime), no images (rendered blocking by
 * some clients), single CTA button + plain-text fallback link.
 *
 * `verifyUrl` MUST be pre-sanitized by `sanitizeUrl` before this
 * component runs; `render.ts` enforces that. This component never
 * calls the sanitizer itself — separation of concerns.
 */
export function VerifyEmail({ userName, verifyUrl }: VerifyEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Verify your email to activate your Runway account.</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>Confirm your email</Heading>
          <Text style={textStyle}>Hi {userName},</Text>
          <Text style={textStyle}>
            Tap the button below to verify this email address and finish setting up
            your account. The link expires in 24 hours.
          </Text>
          <Section style={buttonSectionStyle}>
            <Button href={verifyUrl} style={buttonStyle}>
              Verify email
            </Button>
          </Section>
          <Text style={mutedTextStyle}>
            Or paste this URL into your browser:{" "}
            <Link href={verifyUrl} style={linkStyle}>
              {verifyUrl}
            </Link>
          </Text>
          <Text style={mutedTextStyle}>
            If you didn&apos;t request this, you can ignore the email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const VERIFY_EMAIL_SUBJECT = "Verify your Runway account";

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
