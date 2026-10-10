/**
 * Provider details for the Impressum (German DDG § 5, formerly TMG § 5) and the controller in the
 * privacy policy (GDPR Art. 13). The owner must fill every `null` before German goes public
 * (`i18n.policy.enabledLocales`); while any required field is missing the Impressum is marked
 * noindex and shows a visible placeholder so the gap is caught in review.
 */
export const LEGAL = {
  /** Full name of the person or company operating the site. */
  operatorName: null as string | null,
  /** Legal form and representative, for a company (e.g. "GmbH, vertreten durch …"); null for a sole trader. */
  representedBy: null as string | null,
  /** Postal address lines (no P.O. box). */
  address: [] as string[],
  /** Contact email (must allow fast electronic contact). */
  email: "editor@ai-review.dev" as string | null,
  /** Telephone or a second fast contact channel (required in practice for a quick, direct contact). */
  phone: null as string | null,
  /** VAT ID (USt-IdNr. / CVR-SE), if VAT-registered. */
  vatId: null as string | null,
  /** Commercial register and number, if registered (e.g. "Handelsregister … HRB …" or CVR). */
  register: null as string | null,
  /** Person responsible for editorial content (MStV § 18 Abs. 2): name and address. */
  editorResponsible: null as string | null,
} as const;

export const LEGAL_REQUIRED = ["operatorName", "address", "email", "phone", "editorResponsible"] as const;

export function missingLegalFields(): string[] {
  return LEGAL_REQUIRED.filter((key) => {
    const value = LEGAL[key];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
}
