"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type XmlValue = string | XmlObject | XmlValue[];

type XmlObject = {
  [key: string]: XmlValue;
};

const RAW_PLACEHOLDER_PATTERN = /<<\s*([^<>]+?)\s*>>|{{\s*([^{}]+?)\s*}}/g;
const ENCODED_PLACEHOLDER_PATTERN = /&lt;&lt;\s*([^<>]+?)\s*&gt;&gt;|&#123;&#123;\s*([^{}]+?)\s*&#125;&#125;/g;
const URL_ENCODED_PLACEHOLDER_PATTERN = /%3C%3C\s*([^%]+?)\s*%3E%3E|%7B%7B\s*([^%]+?)\s*%7D%7D/gi;

const PLACEHOLDER_ALIASES: Record<string, string[]> = {
  fullpolicyno: ["fullpolicynumber", "policyno", "policynumber"],
  fullpolicynumber: ["fullpolicyno", "policyno", "policynumber"],
  policyno: ["policynumber", "fullpolicyno", "fullpolicynumber"],
  policyholder: ["policyholdername", "policy_holder", "policyholder_name"],
  customername: ["customer", "fullname", "name"],
};

function normalizeLookupKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeLookupKeyVariant(value: string): string {
  return normalizeLookupKey(value).replace(/number/g, "no");
}

function normalizeHexColor(value?: string): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const validHexPattern = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/;

  return validHexPattern.test(prefixed) ? prefixed : null;
}

function formatDateValue(value: string): string {
  const trimmed = value.trim();
  const dateMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);

  if (!dateMatch) {
    return trimmed;
  }

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const shortYear = Number(dateMatch[3]);

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return trimmed;
  }

  const fullYear = 2000 + shortYear;
  const date = new Date(Date.UTC(fullYear, month - 1, day));

  // Guard invalid calendar dates like 31/02/26.
  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return trimmed;
  }

  const monthName = date.toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });

  return `${String(day).padStart(2, "0")} ${monthName} ${fullYear}`;
}

function addLookupValue(map: Map<string, string>, key: string, value: string) {
  const trimmed = formatDateValue(value);
  if (!trimmed) return;

  const normalized = normalizeLookupKey(key);
  const variant = normalizeLookupKeyVariant(key);

  if (normalized && !map.has(normalized)) {
    map.set(normalized, trimmed);
  }

  if (variant && !map.has(variant)) {
    map.set(variant, trimmed);
  }
}

function buildXmlValueLookup(record: unknown): Map<string, string> {
  const lookup = new Map<string, string>();

  const visit = (value: unknown, currentKey: string | null) => {
    if (typeof value === "string") {
      if (currentKey) {
        addLookupValue(lookup, currentKey, value);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, currentKey);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const obj = value as Record<string, unknown>;

    if (currentKey && typeof obj.value === "string") {
      addLookupValue(lookup, currentKey, obj.value);
    }

    for (const [key, child] of Object.entries(obj)) {
      if (key === "value") {
        continue;
      }
      visit(child, key);
    }
  };

  visit(record, null);
  return lookup;
}

function resolvePlaceholderValue(token: string, lookup: Map<string, string>): string | null {
  const normalizedToken = normalizeLookupKey(token);
  const normalizedTokenVariant = normalizeLookupKeyVariant(token);

  const directMatch =
    lookup.get(normalizedToken) ||
    lookup.get(normalizedTokenVariant);

  if (directMatch) {
    return directMatch;
  }

  const aliases = PLACEHOLDER_ALIASES[normalizedToken] || [];
  for (const alias of aliases) {
    const aliasValue = lookup.get(normalizeLookupKey(alias)) || lookup.get(normalizeLookupKeyVariant(alias));
    if (aliasValue) {
      return aliasValue;
    }
  }

  // Fuzzy fallback for small naming drifts, e.g. FullPolicyNo <-> FullPolicyNumber.
  if (normalizedToken.length >= 5) {
    for (const [key, value] of lookup.entries()) {
      if (key.includes(normalizedToken) || normalizedToken.includes(key)) {
        return value;
      }
    }
  }

  return null;
}

function replaceCmsPlaceholders(templateHtml: string, record: unknown): string {
  if (!templateHtml.trim()) {
    return templateHtml;
  }

  const lookup = buildXmlValueLookup(record);

  const replaceToken = (match: string, primaryToken?: string, secondaryToken?: string) => {
    const token = String(primaryToken || secondaryToken || "").trim();
    if (!token) {
      return match;
    }

    const value = resolvePlaceholderValue(token, lookup);
    return value ?? match;
  };

  const replacePlaceholderTokens = (input: string): string => {
    return input
      .replace(RAW_PLACEHOLDER_PATTERN, replaceToken)
      .replace(ENCODED_PLACEHOLDER_PATTERN, replaceToken)
      .replace(URL_ENCODED_PLACEHOLDER_PATTERN, replaceToken);
  };

  const replacedHtml = replacePlaceholderTokens(templateHtml);

  if (typeof DOMParser === "undefined") {
    return replacedHtml;
  }

  const htmlDoc = new DOMParser().parseFromString(replacedHtml, "text/html");

  for (const anchor of Array.from(htmlDoc.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    const resolvedHref = replacePlaceholderTokens(href);
    if (resolvedHref !== href) {
      anchor.setAttribute("href", resolvedHref);
    }
  }

  return htmlDoc.body.innerHTML;
}

function readFirstStringFromValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readFirstStringFromValue(item);
      if (found) return found;
    }
    return "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;

  // Prefer common attribute/text property names when present.
  for (const key of ["value", "Value"]) {
    const found = readFirstStringFromValue(record[key]);
    if (found) return found;
  }

  for (const item of Object.values(record)) {
    const found = readFirstStringFromValue(item);
    if (found) return found;
  }

  return "";
}

export default function Home() {
  const fallbackLogoSrc = "/next.svg";

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [records, setRecords] = useState<XmlObject[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  // letterCodeFilter is set by the dropdown; empty string means "show all".
  const [letterCodeFilter, setLetterCodeFilter] = useState("");
  const [cmsLoading, setCmsLoading] = useState(false);
  const [cmsErrorMessage, setCmsErrorMessage] = useState<string | null>(null);
  const [cmsNotConfigured, setCmsNotConfigured] = useState(false);
  const [cmsTitle, setCmsTitle] = useState("");
  const [cmsHtml, setCmsHtml] = useState("");
  const [cmsRaw, setCmsRaw] = useState<unknown | null>(null);
  const [cmsBrandPartner, setCmsBrandPartner] = useState<{
    name?: string;
    codename?: string;
    partnerName?: string;
    logoUrl?: string;
    primaryColorHex?: string;
    disclaimer?: string;
  } | null>(null);

  // Convert an XML element recursively into a plain JavaScript object.
  const elementToObject = (element: Element): XmlObject => {
    const childElements = Array.from(element.children);
    const attributes = Array.from(element.attributes);

    const attributeObject: XmlObject = {};
    for (const attribute of attributes) {
      const attrName = attribute.name.trim();
      if (!attrName) continue;
      attributeObject[attrName] = attribute.value ?? "";
    }

    if (childElements.length === 0) {
      const textValue = element.textContent?.trim() ?? "";

      if (Object.keys(attributeObject).length === 0) {
        return { value: textValue };
      }

      // Keep both attributes and text value so callers can read attribute-based XML fields.
      return {
        ...attributeObject,
        ...(textValue ? { value: textValue } : {}),
      };
    }

    const output: XmlObject = {};

    if (Object.keys(attributeObject).length > 0) {
      Object.assign(output, attributeObject);
    }

    for (const child of childElements) {
      const key = child.tagName;
      const value = elementToObject(child);
      const normalizedValue =
        Object.keys(value).length === 1 && "value" in value ? value.value : value;

      if (!(key in output)) {
        output[key] = normalizedValue;
      } else if (Array.isArray(output[key])) {
        (output[key] as XmlValue[]).push(normalizedValue);
      } else {
        output[key] = [output[key], normalizedValue];
      }
    }

    return output;
  };

  // Find the repeating record elements by scanning every element in the document
  // and finding whichever parent has the most repeated direct-child tag name.
  // This correctly handles SOAP envelopes and any arbitrary nesting depth.
  const findRecordElements = (xmlDoc: Document): Element[] => {
    const allElements = Array.from(xmlDoc.getElementsByTagName("*"));

    let bestParent: Element | null = null;
    let bestTag = "";
    let bestCount = 0;

    for (const el of allElements) {
      // Count repeated tag names among this element's direct children.
      const tagCounts = new Map<string, number>();
      for (const child of Array.from(el.children)) {
        tagCounts.set(child.tagName, (tagCounts.get(child.tagName) ?? 0) + 1);
      }
      for (const [tag, count] of tagCounts.entries()) {
        if (count > bestCount) {
          bestParent = el;
          bestTag = tag;
          bestCount = count;
        }
      }
    }

    if (bestParent && bestTag) {
      return Array.from(bestParent.children).filter(
        (el) => el.tagName === bestTag
      );
    }

    return Array.from(xmlDoc.documentElement.children);
  };

  // Load XML from local file, parse it with DOMParser, then store repeating nodes as records.
  const handleLocalFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      setErrorMessage(null);
      setRecords([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setRecords([]);
    setCurrentIndex(0);
    setLetterCodeFilter("");

    try {
      const xmlText = await file.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");

      const parserErrorNode = xmlDoc.querySelector("parsererror");
      if (parserErrorNode) {
        throw new Error("The XML content is invalid and could not be parsed.");
      }

      const recordElements = findRecordElements(xmlDoc);
      if (recordElements.length === 0) {
        throw new Error("No records were found in the XML.");
      }

      const parsedRecords = recordElements.map((element) => {
        const obj: XmlObject = {
          nodeName: element.tagName,
          ...elementToObject(element),
        };

        // When Letter_Code_ is absent or empty, fall back to the first child element
        // name inside Letter_Data (e.g. "SingleDebtors", "AdHocPayment").
        let resolvedCode =
          typeof obj["Letter_Code_"] === "string" ? obj["Letter_Code_"].trim() : "";

        if (!resolvedCode) {
          const letterData = obj["Letter_Data"];
          if (
            letterData !== null &&
            typeof letterData === "object" &&
            !Array.isArray(letterData)
          ) {
            const fallbackKey = Object.keys(letterData as XmlObject)[0];
            if (fallbackKey) {
              resolvedCode = fallbackKey;
            }
          }
        }

        // Always normalize Letter_Code_ to uppercase for filtering and display consistency.
        if (resolvedCode) {
          obj["Letter_Code_"] = resolvedCode.toUpperCase();
        }

        return obj;
      });

      setRecords(parsedRecords);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while loading XML.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Collect unique Letter_Code_ values from all loaded records for the filter dropdown.
  const letterCodes = Array.from(
    new Set(
      records
        .map((r) => {
          const v = r["Letter_Code_"];
          return typeof v === "string" ? v.trim() : "";
        })
        .filter(Boolean)
    )
  ).sort();

  // Apply dropdown filter; when no filter is selected show all records.
  const filteredRecords =
    letterCodeFilter
      ? records.filter((r) => {
          const v = r["Letter_Code_"];
          return typeof v === "string" && v.trim() === letterCodeFilter;
        })
      : records;

  const filteredRecord = filteredRecords[currentIndex] ?? null;
  const currentLetterCode =
    filteredRecord && typeof filteredRecord["Letter_Code_"] === "string"
      ? filteredRecord["Letter_Code_"].trim()
      : "";

  const normalizeFieldKey = (value: string): string => {
    return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  };

  const findFirstStringValueByKey = (obj: unknown, key: string): string => {
    if (obj === null || obj === undefined) {
      return "";
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFirstStringValueByKey(item, key);
        if (found) return found;
      }
      return "";
    }

    if (typeof obj !== "object") {
      return "";
    }

    const record = obj as Record<string, unknown>;
    const targetKey = normalizeFieldKey(key);

    const exactValue = record[key];
    const exactString = readFirstStringFromValue(exactValue);
    if (exactString) {
      return exactString;
    }

    for (const [recordKey, recordValue] of Object.entries(record)) {
      if (normalizeFieldKey(recordKey) === targetKey) {
        const value = readFirstStringFromValue(recordValue);
        if (value) {
          return value;
        }
      }
    }

    for (const value of Object.values(record)) {
      const found = findFirstStringValueByKey(value, key);
      if (found) return found;
    }

    return "";
  };

  const waiverOutcome = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "WaiverOutcome")
    : "";

  const partnerName = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "PartnerName")
    : "";

  const underwriter = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "Underwriter")
    : "";

  const resolvedCmsHtml = useMemo(() => {
    if (!cmsHtml || !filteredRecord) {
      return cmsHtml;
    }

    return replaceCmsPlaceholders(cmsHtml, filteredRecord);
  }, [cmsHtml, filteredRecord]);

  useEffect(() => {
    const loadCmsContent = async () => {
      if (!currentLetterCode) {
        setCmsLoading(false);
        setCmsErrorMessage(null);
        setCmsNotConfigured(false);
        setCmsTitle("");
        setCmsHtml("");
        setCmsRaw(null);
        setCmsBrandPartner(null);
        return;
      }

      setCmsLoading(true);
      setCmsErrorMessage(null);
      setCmsNotConfigured(false);
      setCmsTitle("");
      setCmsHtml("");
      setCmsRaw(null);
      setCmsBrandPartner(null);

      try {
        const queryParams = new URLSearchParams({
          letterCode: currentLetterCode,
        });

        if (waiverOutcome) {
          queryParams.set("waiverOutcome", waiverOutcome);
        }

        if (partnerName) {
          queryParams.set("partnerName", partnerName);
        }

        if (underwriter) {
          queryParams.set("underwriter", underwriter);
        }

        const response = await fetch(`/api/kontent-letter?${queryParams.toString()}`);

        const payload = (await response.json()) as {
          error?: string;
          title?: string;
          html?: string;
          raw?: unknown;
          brandPartner?: {
            name?: string;
            codename?: string;
            partnerName?: string;
            logoUrl?: string;
            primaryColorHex?: string;
            disclaimer?: string;
          } | null;
        };

        if (!response.ok) {
          if (response.status === 404) {
            setCmsNotConfigured(true);
          }
          throw new Error(payload.error || `Unable to load CMS content (${response.status}).`);
        }

        setCmsTitle(payload.title || currentLetterCode);
        setCmsHtml(payload.html || "");
        setCmsRaw(payload.raw ?? null);
        setCmsBrandPartner(payload.brandPartner ?? null);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to load letter content from Kontent.ai.";
        setCmsErrorMessage(message);
      } finally {
        setCmsLoading(false);
      }
    };

    void loadCmsContent();
  }, [currentLetterCode, waiverOutcome, partnerName, underwriter]);

  const cmsLetterLogoSrc = cmsBrandPartner?.logoUrl || fallbackLogoSrc;
  const cmsLetterLogoAlt = cmsBrandPartner?.partnerName || "Brand Partner Logo";
  const cmsBrandColor = normalizeHexColor(cmsBrandPartner?.primaryColorHex) || "#e5e7eb";
  const cmsLetterLayerBackground = `${cmsBrandColor}1A`;

  return (
    <main
      style={{
        maxWidth: "1400px",
        width: "100%",
        margin: "0 auto",
        padding: "2rem 1rem",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ marginBottom: "1rem", fontSize: "1.6rem" }}>Comms Live Preview from XML</h1>

      <section
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)",
          alignItems: "start",
        }}
      >
        <article
          style={{
            border: "1px solid #d6d6d6",
            borderRadius: "8px",
            backgroundColor: cmsLetterLayerBackground,
            padding: "1rem",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1.1rem" }}>
            CMS Letter Content
          </h2>

          {!currentLetterCode && (
            <p style={{ margin: 0, color: "#666" }}>
              Load XML and select a record to render its letter content from Kontent.ai.
            </p>
          )}

          {currentLetterCode && (
            <p style={{ marginTop: 0, marginBottom: "0.75rem", color: "#333", fontSize: "0.9rem" }}>
              Letter Code: <strong>{currentLetterCode}</strong>
            </p>
          )}

          {cmsLoading && <p style={{ margin: 0, color: "#555" }}>Loading CMS content...</p>}

          {cmsErrorMessage && (
            <p style={{ margin: 0, color: "#b00020" }}>Error: {cmsErrorMessage}</p>
          )}

          {!cmsLoading && cmsNotConfigured && currentLetterCode && (
            <p style={{ marginTop: "0.75rem", color: "#555" }}>
              No template is configured in Kontent.ai for letter code
              {" "}
              <strong>{currentLetterCode}</strong>.
            </p>
          )}

          {!cmsLoading && !cmsErrorMessage && cmsTitle && (
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>{cmsTitle}</h3>
          )}

          {!cmsLoading && !cmsErrorMessage && resolvedCmsHtml && (
            <section
              style={{
                border: "1px solid #e5e5e5",
                borderTop: `4px solid ${cmsBrandColor}`,
                borderRadius: "8px",
                padding: "0.9rem",
                backgroundColor: "#ffffff",
              }}
            >
              <div style={{ marginBottom: "2.2rem" }}>
                <Image
                  src={cmsLetterLogoSrc}
                  alt={cmsLetterLogoAlt}
                  width={260}
                  height={55}
                  style={{ width: "min(100%, 260px)", height: "auto", objectFit: "contain" }}
                />
              </div>

              <div
                className="cms-rich-text"
                dangerouslySetInnerHTML={{ __html: resolvedCmsHtml }}
              />

              {cmsBrandPartner?.disclaimer && (
                <div
                  style={{
                    marginTop: "2.5rem",
                    paddingTop: "1.5rem",
                    borderTop: `2px solid ${cmsBrandColor}`,
                    fontSize: "0.9rem",
                    color: "#555",
                    lineHeight: 1.6,
                  }}
                >
                  <strong style={{ display: "block", marginBottom: "0.5rem", color: "#333" }}>
                    Disclaimer:
                  </strong>
                  <div
                    className="cms-rich-text"
                    style={{ fontSize: "0.9rem" }}
                    dangerouslySetInnerHTML={{ __html: cmsBrandPartner.disclaimer }}
                  />
                </div>
              )}
            </section>
          )}

          {!cmsLoading && !cmsErrorMessage && !cmsHtml && cmsRaw !== null && (
            <pre
              style={{
                margin: 0,
                padding: "1rem",
                overflowX: "auto",
                borderRadius: "8px",
                border: "1px solid #d6d6d6",
                backgroundColor: "#f3f4f6",
                fontSize: "0.85rem",
              }}
            >
              {JSON.stringify(cmsRaw, null, 2)}
            </pre>
          )}
        </article>

        <section style={{ display: "grid", gap: "1rem" }}>
          <article
            style={{
              border: "1px solid #d6d6d6",
              borderRadius: "8px",
              backgroundColor: "#fafafa",
              padding: "1rem",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1.1rem" }}>
              Copy the path to the file below:
            </h2>

            <section
              style={{
                display: "grid",
                gap: "0.75rem",
              }}
            >
              <label htmlFor="xml-file">File path</label>
              <input
                id="xml-file"
                type="file"
                accept=".xml"
                onChange={handleLocalFileSelect}
                disabled={isLoading}
                style={{
                  padding: "0.5rem",
                  border: "1px solid #b9b9b9",
                  borderRadius: "6px",
                  backgroundColor: "#fff",
                }}
              />

              <small style={{ color: "#555" }}>
                Select an XML file from your computer to preview the letter content.
              </small>

              {errorMessage && (
                <p style={{ margin: 0, color: "#b00020" }}>Error: {errorMessage}</p>
              )}
            </section>
          </article>

          <article
            style={{
              border: "1px solid #d6d6d6",
              borderRadius: "8px",
              backgroundColor: "#ffffff",
              padding: "1rem",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1.1rem" }}>
              XML Record Panel
            </h2>

          {records.length > 0 && (
            <p style={{ marginTop: 0, marginBottom: "0.75rem", color: "#333", fontSize: "0.9rem" }}>
              Loaded <strong>{records.length}</strong> record{records.length !== 1 ? "s" : ""}.
              {letterCodes.length > 0
                ? ` Letter codes found: ${letterCodes.join(", ")}.`
                : " No Letter_Code_ values detected in this XML."}
            </p>
          )}

          {records.length > 0 && (
            <section
              style={{
                marginBottom: "0.75rem",
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              {/* Letter type filter — resets navigation index when changed */}
              <label htmlFor="letter-code-filter" style={{ fontWeight: 500 }}>
                Filter by Letter Type:
              </label>
              <select
                id="letter-code-filter"
                value={letterCodeFilter}
                onChange={(event) => {
                  setLetterCodeFilter(event.target.value);
                  setCurrentIndex(0);
                }}
                style={{
                  padding: "0.4rem 0.6rem",
                  border: "1px solid #b9b9b9",
                  borderRadius: "6px",
                  backgroundColor: "#fff",
                }}
              >
                <option value="">All ({records.length})</option>
                {letterCodes.map((code) => (
                  <option key={code} value={code}>
                    {code} (
                    {records.filter((r) => r["Letter_Code_"] === code).length})
                  </option>
                ))}
              </select>
            </section>
          )}

          {filteredRecords.length > 0 && (
            <section
              style={{
                marginBottom: "0.75rem",
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => prev - 1)}
                disabled={currentIndex === 0 || isLoading}
                style={{
                  padding: "0.5rem 0.75rem",
                  border: "1px solid #b9b9b9",
                  borderRadius: "6px",
                  backgroundColor: "#fff",
                  cursor: currentIndex === 0 || isLoading ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>

              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => prev + 1)}
                disabled={currentIndex === filteredRecords.length - 1 || isLoading}
                style={{
                  padding: "0.5rem 0.75rem",
                  border: "1px solid #b9b9b9",
                  borderRadius: "6px",
                  backgroundColor: "#fff",
                  cursor:
                    currentIndex === filteredRecords.length - 1 || isLoading
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Next
              </button>

              <span>
                Record {currentIndex + 1} of {filteredRecords.length}
              </span>
            </section>
          )}

          {filteredRecords.length === 0 && records.length > 0 && (
            <p style={{ marginTop: 0, marginBottom: "0.75rem", color: "#555" }}>
              No records match the selected letter type.
            </p>
          )}

            {filteredRecord !== null && (
              <section>
              <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
                Record {currentIndex + 1}{" "}
                <span style={{ color: "#555", fontWeight: 400, fontSize: "0.9rem" }}>
                  — {String(filteredRecord["Letter_Code_"] ?? "Unknown letter type")}
                </span>
              </h3>

              {/* Letter envelope metadata — fields that sit directly on each Letter record */}
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid #d6d6d6",
                  backgroundColor: "#fafafa",
                  marginBottom: "0.75rem",
                  display: "grid",
                  gridTemplateColumns: "max-content 1fr",
                  columnGap: "1.5rem",
                  rowGap: "0.3rem",
                  fontSize: "0.9rem",
                }}
              >
                {([
                  "Entry_No_",
                  "Letter_Code_",
                  "Action",
                  "Email",
                  "Version_No_",
                  "Opted-Out",
                ] as const).map((key) =>
                  key in filteredRecord ? (
                    <Fragment key={key}>
                      <span style={{ color: "#555", fontWeight: 500 }}>{key}</span>
                      <span>{String(filteredRecord[key])}</span>
                    </Fragment>
                  ) : null
                )}
              </div>

              {/* Letter_Data content — schema varies per Letter_Code_ */}
              {"Letter_Data" in filteredRecord && (
                <>
                  <h4 style={{ marginTop: 0, marginBottom: "0.4rem", fontSize: "0.95rem", color: "#333" }}>
                    Letter Data
                  </h4>
                  <pre
                    style={{
                      margin: 0,
                      padding: "1rem",
                      overflowX: "auto",
                      borderRadius: "8px",
                      border: "1px solid #d6d6d6",
                      backgroundColor: "#f3f4f6",
                      fontSize: "0.85rem",
                    }}
                  >
                    {JSON.stringify(filteredRecord["Letter_Data"], null, 2)}
                  </pre>
                </>
              )}
              </section>
            )}
          </article>
        </section>
      </section>
    </main>
  );
}
