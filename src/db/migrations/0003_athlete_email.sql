-- Log-in for the demo account (D-041). Athletes created through onboarding have no email.
ALTER TABLE athletes ADD COLUMN email TEXT;
CREATE UNIQUE INDEX athletes_email ON athletes (email);
