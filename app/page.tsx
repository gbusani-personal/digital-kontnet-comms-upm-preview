"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

type XmlValue = string | XmlObject | XmlValue[];

type XmlObject = {
  [key: string]: XmlValue;
};

type BrandPartnerData = {
  name?: string;
  codename?: string;
  partnerName?: string;
  logoUrl?: string;
  primaryColorHex?: string;
  disclaimer?: string;
  routineCareBenefitLimit?: string;
  boosterCareBenefitLimit?: string;
};

type CmsVersionState = {
  title: string;
  html: string;
  raw: unknown | null;
  brandPartner: BrandPartnerData | null;
  otherAssetsOptions?: OtherAssetsOption[];
  selectedOtherAssetsCodename?: string;
};

type OtherAssetsOption = {
  codename: string;
  name: string;
};

const RAW_PLACEHOLDER_PATTERN = /<<\s*([^<>]+?)\s*>>|{{\s*([^{}]+?)\s*}}/g;
const ENCODED_PLACEHOLDER_PATTERN = /&lt;&lt;\s*([^<>]+?)\s*&gt;&gt;|&#123;&#123;\s*([^{}]+?)\s*&#125;&#125;/g;
const URL_ENCODED_PLACEHOLDER_PATTERN = /%3C%3C\s*([^%]+?)\s*%3E%3E|%7B%7B\s*([^%]+?)\s*%7D%7D/gi;
const ANY_PLACEHOLDER_PATTERN = /<<\s*([^<>]+?)\s*>>|{{\s*([^{}]+?)\s*}}|&lt;&lt;\s*([^<>]+?)\s*&gt;&gt;|&#123;&#123;\s*([^{}]+?)\s*&#125;&#125;|%3C%3C\s*([^%]+?)\s*%3E%3E|%7B%7B\s*([^%]+?)\s*%7D%7D/gi;

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

function expandHexColor(hexColor: string): string {
  const normalized = hexColor.startsWith("#") ? hexColor : `#${hexColor}`;

  if (normalized.length === 4) {
    const [r, g, b] = normalized.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return normalized;
}

function getContrastTextColor(backgroundHex: string): "#111111" | "#ffffff" {
  const expanded = expandHexColor(backgroundHex);
  const r = parseInt(expanded.slice(1, 3), 16) / 255;
  const g = parseInt(expanded.slice(3, 5), 16) / 255;
  const b = parseInt(expanded.slice(5, 7), 16) / 255;

  const linearize = (channel: number): number => {
    if (channel <= 0.03928) {
      return channel / 12.92;
    }

    return ((channel + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);

  return luminance > 0.5 ? "#111111" : "#ffffff";
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

const BRAND_PARTNER_ONLY_PLACEHOLDERS = new Set([
  "routinecarebenefitlimit",
  "boostercarebenefitlimit",
]);

function resolveBrandPartnerOnlyPlaceholderValue(
  token: string,
  brandPartner: BrandPartnerData | null | undefined
): string | null | undefined {
  const normalizedToken = normalizeLookupKey(token);

  if (!BRAND_PARTNER_ONLY_PLACEHOLDERS.has(normalizedToken)) {
    return undefined;
  }

  if (!brandPartner) {
    return null;
  }

  if (normalizedToken === "routinecarebenefitlimit") {
    const value = (brandPartner.routineCareBenefitLimit || "").trim();
    return value || null;
  }

  const value = (brandPartner.boosterCareBenefitLimit || "").trim();
  return value || null;
}

function replaceCmsPlaceholders(
  templateHtml: string,
  record: unknown,
  brandPartner: BrandPartnerData | null | undefined,
  showResolvedValues: boolean,
  highlightPlaceholders: boolean
): string {
  if (!templateHtml.trim()) {
    return templateHtml;
  }

  const lookup = buildXmlValueLookup(record);

  const resolveTokenValue = (token: string): string | null => {
    const brandPartnerOnlyValue = resolveBrandPartnerOnlyPlaceholderValue(token, brandPartner);
    if (brandPartnerOnlyValue !== undefined) {
      return brandPartnerOnlyValue;
    }

    return resolvePlaceholderValue(token, lookup);
  };

  const replaceToken = (match: string, primaryToken?: string, secondaryToken?: string) => {
    const token = String(primaryToken || secondaryToken || "").trim();
    if (!token) {
      return match;
    }

    const value = resolveTokenValue(token);
    return value ?? match;
  };

  const replacePlaceholderTokens = (input: string): string => {
    return input
      .replace(RAW_PLACEHOLDER_PATTERN, replaceToken)
      .replace(ENCODED_PLACEHOLDER_PATTERN, replaceToken)
      .replace(URL_ENCODED_PLACEHOLDER_PATTERN, replaceToken);
  };

  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return showResolvedValues ? replacePlaceholderTokens(templateHtml) : templateHtml;
  }

  const htmlDoc = new DOMParser().parseFromString(templateHtml, "text/html");

  if (showResolvedValues) {
    // Resolve placeholders in all attributes (href, src, title, etc.) as plain text values.
    for (const element of Array.from(htmlDoc.body.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        const resolvedAttributeValue = replacePlaceholderTokens(attribute.value);
        if (resolvedAttributeValue !== attribute.value) {
          element.setAttribute(attribute.name, resolvedAttributeValue);
        }
      }
    }
  }

  // Highlight only text-node replacements so users can see injected XML values.
  const textWalker = htmlDoc.createTreeWalker(htmlDoc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (textWalker.nextNode()) {
    textNodes.push(textWalker.currentNode as Text);
  }

  for (const textNode of textNodes) {
    const textContent = textNode.nodeValue ?? "";
    if (!textContent) {
      continue;
    }

    const regex = new RegExp(ANY_PLACEHOLDER_PATTERN.source, "gi");
    const matches = Array.from(textContent.matchAll(regex));
    if (matches.length === 0) {
      continue;
    }

    const fragment = htmlDoc.createDocumentFragment();
    let cursor = 0;
    let hasReplacement = false;

    for (const match of matches) {
      const fullMatch = match[0] ?? "";
      const matchIndex = match.index ?? 0;

      if (matchIndex > cursor) {
        fragment.appendChild(htmlDoc.createTextNode(textContent.slice(cursor, matchIndex)));
      }

      const token =
        String(match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || "").trim();

      const resolvedValue = token ? resolveTokenValue(token) : null;

      if (showResolvedValues && resolvedValue !== null) {
        if (highlightPlaceholders) {
          const highlightedSpan = htmlDoc.createElement("span");
          highlightedSpan.className = "cms-placeholder-highlight";
          highlightedSpan.textContent = resolvedValue;
          fragment.appendChild(highlightedSpan);
        } else {
          fragment.appendChild(htmlDoc.createTextNode(resolvedValue));
        }
        hasReplacement = true;
      } else if (!showResolvedValues) {
        if (highlightPlaceholders) {
          const highlightedSpan = htmlDoc.createElement("span");
          highlightedSpan.className = "cms-placeholder-highlight";
          highlightedSpan.textContent = fullMatch;
          fragment.appendChild(highlightedSpan);
        } else {
          fragment.appendChild(htmlDoc.createTextNode(fullMatch));
        }
        hasReplacement = true;
      } else {
        fragment.appendChild(htmlDoc.createTextNode(fullMatch));
      }

      cursor = matchIndex + fullMatch.length;
    }

    if (cursor < textContent.length) {
      fragment.appendChild(htmlDoc.createTextNode(textContent.slice(cursor)));
    }

    if (hasReplacement) {
      textNode.parentNode?.replaceChild(fragment, textNode);
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

const WHOLE_PLACEHOLDER_PATTERN = new RegExp(`^(${ANY_PLACEHOLDER_PATTERN.source})$`, "i");

function isWholePlaceholderToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return WHOLE_PLACEHOLDER_PATTERN.test(trimmed);
}

type TokenPiece = {
  raw: string;
  comparable: boolean;
  normalized: string;
};

function normalizeComparableToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function tokenizeTextPieces(value: string): TokenPiece[] {
  const chunks = value.split(/(\s+)/);

  return chunks.map((chunk) => {
    if (!chunk || /^\s+$/.test(chunk)) {
      return {
        raw: chunk,
        comparable: false,
        normalized: "",
      };
    }

    if (isWholePlaceholderToken(chunk)) {
      return {
        raw: chunk,
        comparable: false,
        normalized: "",
      };
    }

    const normalized = normalizeComparableToken(chunk);
    return {
      raw: chunk,
      comparable: normalized.length > 0,
      normalized,
    };
  });
}

function computeCurrentLcsIndexes(currentTokens: string[], previousTokens: string[]): Set<number> {
  const rowCount = currentTokens.length;
  const colCount = previousTokens.length;

  if (rowCount === 0 || colCount === 0) {
    return new Set<number>();
  }

  const matrix: number[][] = Array.from({ length: rowCount + 1 }, () => Array(colCount + 1).fill(0));

  for (let row = 1; row <= rowCount; row += 1) {
    for (let col = 1; col <= colCount; col += 1) {
      if (currentTokens[row - 1] === previousTokens[col - 1]) {
        matrix[row][col] = matrix[row - 1][col - 1] + 1;
      } else {
        matrix[row][col] = Math.max(matrix[row - 1][col], matrix[row][col - 1]);
      }
    }
  }

  const matchedIndexes = new Set<number>();
  let row = rowCount;
  let col = colCount;

  while (row > 0 && col > 0) {
    if (currentTokens[row - 1] === previousTokens[col - 1]) {
      matchedIndexes.add(row - 1);
      row -= 1;
      col -= 1;
      continue;
    }

    if (matrix[row - 1][col] >= matrix[row][col - 1]) {
      row -= 1;
    } else {
      col -= 1;
    }
  }

  return matchedIndexes;
}

function highlightAddedRichText(previousHtml: string, currentHtml: string): string {
  if (!currentHtml) {
    return "";
  }

  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return currentHtml;
  }

  const previousDoc = new DOMParser().parseFromString(previousHtml || "", "text/html");
  const currentDoc = new DOMParser().parseFromString(currentHtml, "text/html");

  const collectTextNodes = (docValue: Document): Text[] => {
    const walker = docValue.createTreeWalker(docValue.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const parentElement = textNode.parentElement;

      if (!parentElement) {
        continue;
      }

      if (parentElement.closest("script,style,.cms-placeholder-highlight")) {
        continue;
      }

      nodes.push(textNode);
    }

    return nodes;
  };

  const previousNodes = collectTextNodes(previousDoc);
  const currentNodes = collectTextNodes(currentDoc);

  const previousComparableTokens = previousNodes
    .flatMap((node) => tokenizeTextPieces(node.nodeValue || ""))
    .filter((piece) => piece.comparable)
    .map((piece) => piece.normalized);

  const currentTokenPiecesByNode = currentNodes.map((node) => tokenizeTextPieces(node.nodeValue || ""));
  const currentComparableTokens = currentTokenPiecesByNode
    .flat()
    .filter((piece) => piece.comparable)
    .map((piece) => piece.normalized);

  const lcsMatchedCurrentIndexes = computeCurrentLcsIndexes(currentComparableTokens, previousComparableTokens);
  let comparableTokenCursor = 0;

  currentNodes.forEach((currentNode, nodeIndex) => {
    const tokenPieces = currentTokenPiecesByNode[nodeIndex];

    const fragment = currentDoc.createDocumentFragment();
    let hasHighlight = false;

    for (const piece of tokenPieces) {
      if (!piece.comparable) {
        fragment.appendChild(currentDoc.createTextNode(piece.raw));
        continue;
      }

      const isUnchanged = lcsMatchedCurrentIndexes.has(comparableTokenCursor);
      comparableTokenCursor += 1;

      if (isUnchanged) {
        fragment.appendChild(currentDoc.createTextNode(piece.raw));
        continue;
      }

      const span = currentDoc.createElement("span");
      span.className = "cms-diff-added";
      span.textContent = piece.raw;
      fragment.appendChild(span);
      hasHighlight = true;
    }

    if (hasHighlight) {
      currentNode.parentNode?.replaceChild(fragment, currentNode);
    }
  });

  return currentDoc.body.innerHTML;
}

export default function Home() {
  const fallbackLogoSrc = "/next.svg";

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [records, setRecords] = useState<XmlObject[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  // letterCodeFilter is set by the dropdown; empty string means "show all".
  const [letterCodeFilter, setLetterCodeFilter] = useState("");
  const [letterTemplateFilter, setLetterTemplateFilter] = useState("");
  const [cmsLoading, setCmsLoading] = useState(false);
  const [cmsErrorMessage, setCmsErrorMessage] = useState<string | null>(null);
  const [cmsNoticeMessage, setCmsNoticeMessage] = useState<string | null>(null);
  const [cmsNotConfigured, setCmsNotConfigured] = useState(false);
  const [showResolvedCmsValues, setShowResolvedCmsValues] = useState(true);
  const [highlightCmsPlaceholders, setHighlightCmsPlaceholders] = useState(false);
  // Toggle to switch between draft (preview API) and published (delivery API) content.
  const [usePreviewContent, setUsePreviewContent] = useState(true);
  const [comparePublishedToDraft, setComparePublishedToDraft] = useState(false);
  const [draftContent, setDraftContent] = useState<CmsVersionState>({
    title: "",
    html: "",
    raw: null,
    brandPartner: null,
  });
  const [publishedContent, setPublishedContent] = useState<CmsVersionState>({
    title: "",
    html: "",
    raw: null,
    brandPartner: null,
  });
  const [otherAssetsOptions, setOtherAssetsOptions] = useState<OtherAssetsOption[]>([]);
  const [selectedOtherAssetsCodename, setSelectedOtherAssetsCodename] = useState("");
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  // Tracks the last record-level deps so we can detect navigation vs. dropdown selection changes.
  const coiRecordKeyRef = useRef("");

  // Convert an XML element recursively into a plain JavaScript object.
  const elementToObject = (element: Element): XmlObject => {
    const childElements = Array.from(element.children);
    const attributes = Array.from(element.attributes);

    const attributeObject: XmlObject = {};
    for (const attribute of attributes) {
      const attrName = (attribute.localName || attribute.name).trim();
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
      const key = child.localName || child.tagName;
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

    const letterCandidates = allElements.filter((el) => {
      const localName = (el.localName || el.tagName).toLowerCase();
      if (localName !== "letter" && !localName.endsWith("letter")) {
        return false;
      }

      return Array.from(el.getElementsByTagName("*")).some((child) => {
        const childName = child.localName || child.tagName;
        return childName === "Letter_Code_" || childName === "Letter_Code";
      });
    });

    if (letterCandidates.length > 0) {
      const leafCandidates = letterCandidates.filter((candidate) =>
        !letterCandidates.some(
          (other) =>
            other !== candidate &&
            candidate.contains(other)
        )
      );

      return leafCandidates.length > 0 ? leafCandidates : letterCandidates;
    }

    let bestParent: Element | null = null;
    let bestTag = "";
    let bestCount = 0;

    for (const el of allElements) {
      const tagCounts = new Map<string, number>();
      for (const child of Array.from(el.children)) {
        const childName = child.localName || child.tagName;
        tagCounts.set(childName, (tagCounts.get(childName) ?? 0) + 1);
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
        (el) => (el.localName || el.tagName) === bestTag
      );
    }

    const letterCodeCandidates = allElements.filter((el) =>
      Array.from(el.children).some((child) => {
        const childName = child.localName || child.tagName;
        return childName === "Letter_Code_" || childName === "Letter_Code";
      })
    );

    if (letterCodeCandidates.length > 0) {
      return letterCodeCandidates;
    }

    return Array.from(xmlDoc.documentElement.children);
  };

  // Load XML from local file, parse it with DOMParser, then store repeating nodes as records.
  const handleLocalFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      setErrorMessage(null);
      setRecords([]);
      setSelectedFileName("");
      setShowResolvedCmsValues(true);
      setHighlightCmsPlaceholders(false);
      setUsePreviewContent(true);
      setComparePublishedToDraft(false);
      return;
    }

    setSelectedFileName(file.name);

    setIsLoading(true);
    setErrorMessage(null);
    setRecords([]);
    setCurrentIndex(0);
    setLetterCodeFilter("");
    // Reset UI toggles to the default XML view whenever a new XML is loaded.
    setShowResolvedCmsValues(true);
    setHighlightCmsPlaceholders(false);
    setUsePreviewContent(true);
    setComparePublishedToDraft(false);

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

        // When Letter_Code_ is absent or empty, look recursively for Letter_Code_ anywhere in the record.
        let resolvedCode =
          typeof obj["Letter_Code_"] === "string" ? obj["Letter_Code_"].trim() : "";

        if (!resolvedCode) {
          resolvedCode =
            findFirstStringValueByKey(obj, "Letter_Code_") ||
            findFirstStringValueByKey(obj, "LetterCode") ||
            findFirstStringValueByKey(obj, "Letter Code");
        }

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

  const isNullLikeValue = (value: string): boolean => {
    const normalized = normalizeFieldKey(value);
    return !normalized || normalized === "null" || normalized === "none" || normalized === "na";
  };

  const isYesValue = (value: string): boolean => {
    const normalized = normalizeFieldKey(value);
    return normalized === "yes" || normalized === "y" || normalized === "true" || normalized === "1";
  };

  const resolveRenewalTemplateName = (record: XmlObject): string => {
    const letterType =
      findFirstStringValueByKey(record, "Letter_Type") ||
      findFirstStringValueByKey(record, "LetterType");
    const letterReasonCode =
      findFirstStringValueByKey(record, "LetterReasonCode") ||
      findFirstStringValueByKey(record, "LetterReason") ||
      findFirstStringValueByKey(record, "LetterReasonCode_");
    const clientNumberType =
      findFirstStringValueByKey(record, "ClientNumberGroup.ClientNumberType") ||
      findFirstStringValueByKey(record, "ClientNumberType");

    const normalizedType = normalizeFieldKey(letterType);
    const normalizedReason = normalizeFieldKey(letterReasonCode);
    const normalizedClientType = normalizeFieldKey(clientNumberType);

    if (normalizedType === "standard") {
      if (normalizedReason === "nor") {
        // Check for ClientNumberGroup variants first
        if (normalizedClientType === "bupamember") {
          return "AUTO RENEWAL - MEMBER";
        }
        if (normalizedClientType === "bupastaff") {
          return "AUTO RENEWAL - STAFF";
        }
        // Default to standard AUTO RENEWAL
        return "AUTO RENEWAL";
      }
      if (normalizedReason === "for") {
        return "AUTO RENEWAL - FORCED";
      }
    }

    if (normalizedType === "renewaloffer" || normalizedType === "offer") {
      if (normalizedReason === "nor") {
        return "RENEWAL OFFER";
      }
      if (normalizedReason === "for") {
        return "RENEWAL OFFER - FORCED";
      }
    }

    if (normalizedType === "renewalaccepted" || normalizedType === "acceptance") {
      return "RENEWAL ACCEPTANCE";
    }

    return "";
  };

  const getClWaiverTemplateName = (record: XmlObject): string => {
    return findFirstStringValueByKey(record, "WaiverOutcome").trim();
  };

  const getCancelTemplateName = (record: XmlObject): string => {
    const cancellationReason = findFirstStringValueByKey(record, "CancellationReason");
    const cancelWithCoolingPeriod =
      findFirstStringValueByKey(record, "CancelWithCoolingPeriod") ||
      findFirstStringValueByKey(record, "CancelWithinCoolingPeriod");
    const cxPremiumDueDate = findFirstStringValueByKey(record, "CXPremiumDueDate");

    const normalizedReason = normalizeFieldKey(cancellationReason);
    const prefixMap: Record<string, string> = {
      petdied: "PET_DIED",
      petmissing: "PET_MISSING",
      other: "OTHER",
    };

    if (normalizedReason in prefixMap) {
      const prefix = prefixMap[normalizedReason];
      if (isYesValue(cancelWithCoolingPeriod)) {
        return `${prefix}_COOLING_OFF_PERIOD`;
      }
      if (isNullLikeValue(cxPremiumDueDate)) {
        return `${prefix}_NO_PREMIUM_DUE`;
      }
      return `${prefix}_PREMIUM_DUE`;
    }

    const directReasonMap: Record<string, string> = {
      nonpayment: "NON_PAYMENTS",
      policyinissued: "POLICY_IN_ISSUED",
      renewallapsed: "RENEWAL_LAPSED",
      renewalcancelledannual: "RENEWAL_CANCELLED_ANNUAL",
      renewalcancelledinstalment: "RENEWAL_CANCELLED_INSTALMENT",
    };

    return directReasonMap[normalizedReason] || "";
  };

  const getComplaintTemplateName = (record: XmlObject): string => {
    const taskSubcategoryCode = findFirstStringValueByKey(record, "TaskSubcategoryCode");
    const upmTrigger =
      findFirstStringValueByKey(record, "UPMTrigger") ||
      findFirstStringValueByKey(record, "UPMTriger");
    const idrDelayReason = findFirstStringValueByKey(record, "IDRDelayReason");

    const normalizedTask = normalizeFieldKey(taskSubcategoryCode);
    const isCstComplaint = normalizedTask === "scat0314" || normalizedTask === "scat0117";
    const prefix = isCstComplaint ? "CST" : "IDR";
    const normalizedTrigger = normalizeFieldKey(upmTrigger);

    if (normalizedTrigger === "followup") {
      return `${prefix}_FOLLOWUP`;
    }

    if (normalizedTrigger === "delayed") {
      const delayReasonMap: Record<string, string> = {
        complaintnonresponse: "COMPLAINT",
        complexcase: "COMPLEX",
        highcomplaintvolumes: "HIGH",
        informationrequiredfromthirdparty: "INFORMATION",
      };
      const suffix = delayReasonMap[normalizeFieldKey(idrDelayReason)];
      return suffix ? `${prefix}_${suffix}` : "";
    }

    return "";
  };

  const getEndorsementTemplateName = (record: XmlObject): string => {
    const autoRenewal = findFirstStringValueByKey(record, "Auto-Renewal");
    const normalizedValue = normalizeFieldKey(autoRenewal);

    if (normalizedValue === "nor") {
      return "AUTO RENEWAL";
    }
    if (normalizedValue === "for") {
      return "AUTO RENEWAL - FORCED";
    }

    return autoRenewal.trim();
  };

  const getSingleDebtorsTemplateName = (record: XmlObject): string => {
    const letterType = findFirstStringValueByKey(record, "Letter_Type") ||
      findFirstStringValueByKey(record, "LetterType");
    const rejectionCount = findFirstStringValueByKey(record, "RejectionCount") ||
      findFirstStringValueByKey(record, "Rejection_Count") ||
      findFirstStringValueByKey(record, "Rejection Count");

    if (!letterType.trim() || !rejectionCount.trim()) {
      return "";
    }

    const normalizedLetterType = normalizeFieldKey(letterType);
    const parsedRejectionCount = parseInt(rejectionCount.replace(/\D/g, ""), 10);
    const rejectionLevel = parsedRejectionCount >= 2 ? "second" : "first";

    const isActivePolicyPortal = normalizedLetterType.includes("policyactiveportal");
    const isCancelPolicyPortal =
      normalizedLetterType.includes("policycancelledportal") ||
      normalizedLetterType.includes("policycancellationpendingportal") ||
      normalizedLetterType.includes("policycancelledbyendorsementportal") ||
      normalizedLetterType.includes("policycancelledbyfixitportal");

    const isActivePolicyNonportal = normalizedLetterType.includes("policyactivenonportal");
    const isCancelPolicyNonportal =
      normalizedLetterType.includes("policycancellednonportal") ||
      normalizedLetterType.includes("policycancellationpendingnonportal") ||
      normalizedLetterType.includes("policycancelledbyendorsementnonportal") ||
      normalizedLetterType.includes("policycancelledbyfixitnonportal");

    if (isActivePolicyPortal) {
      return `${rejectionLevel}_rejection_active_policy_portal`;
    } else if (isCancelPolicyPortal) {
      return `${rejectionLevel}_rejection_cancel_policy_portal`;
    } else if (isActivePolicyNonportal) {
      return `${rejectionLevel}_rejection_active_policy_nonportal`;
    } else if (isCancelPolicyNonportal) {
      return `${rejectionLevel}_rejection_cancel_policy_nonportal`;
    }

    return "";
  };

  const getMultiDebtorsTemplateName = (record: XmlObject): string => {
    const letterType = findFirstStringValueByKey(record, "Letter_Type") ||
      findFirstStringValueByKey(record, "LetterType");

    if (!letterType.trim()) {
      return "";
    }

    const normalizedLetterType = normalizeFieldKey(letterType);

    const isActivePolicyPortal = normalizedLetterType.includes("policyactiveportal");
    const isCancelPolicyPortal =
      normalizedLetterType.includes("policycancelledportal") ||
      normalizedLetterType.includes("policycancellationpendingportal") ||
      normalizedLetterType.includes("policycancelledbyendorsementportal") ||
      normalizedLetterType.includes("policycancelledbyfixitportal");

    const isActivePolicyNonportal = normalizedLetterType.includes("policyactivenonportal");
    const isCancelPolicyNonportal =
      normalizedLetterType.includes("policycancellednonportal") ||
      normalizedLetterType.includes("policycancellationpendingnonportal") ||
      normalizedLetterType.includes("policycancelledbyendorsementnonportal") ||
      normalizedLetterType.includes("policycancelledbyfixitnonportal");

    if (isActivePolicyPortal) {
      return "active_policy_portal";
    } else if (isCancelPolicyPortal) {
      return "cancel_policy_portal";
    } else if (isActivePolicyNonportal) {
      return "active_policy_nonportal";
    } else if (isCancelPolicyNonportal) {
      return "cancel_policy_nonportal";
    }

    return "";
  };

  const getTemplateDisplayName = (templateCodename: string): string => {
    // Convert codenames like "first_rejection_active_policy_portal" to "First Rejection Active Policy - Portal"
    return templateCodename
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ")
      .replace(/Portal$/, "- Portal")
      .replace(/Nonportal$/, "- Non-Portal");
  };

  const getTemplateVariantValue = (record: XmlObject): string => {
    const candidateKeys = [
      "Letter_Template",
      "LetterTemplate",
      "Template",
      "Letter_Template_Name",
      "LetterTemplateName",
      "TemplateName",
    ];

    for (const key of candidateKeys) {
      const value = findFirstStringValueByKey(record, key).trim();
      if (!value) {
        continue;
      }

      const letterCode =
        typeof record["Letter_Code_"] === "string"
          ? record["Letter_Code_"].trim().toUpperCase()
          : "";

      if (letterCode && normalizeFieldKey(value) === normalizeFieldKey(letterCode)) {
        continue;
      }

      return value;
    }

    const letterCode =
      typeof record["Letter_Code_"] === "string"
        ? record["Letter_Code_"].trim().toUpperCase()
        : "";

    if (letterCode === "RENEWAL") {
      const resolvedName = resolveRenewalTemplateName(record);
      return resolvedName || letterCode;
    }

    if (letterCode === "CLWAIVER") {
      const resolvedName = getClWaiverTemplateName(record);
      return resolvedName || letterCode;
    }

    if (letterCode === "CANCEL") {
      const resolvedName = getCancelTemplateName(record);
      return resolvedName || letterCode;
    }

    if (letterCode === "COMPLAINT") {
      const resolvedName = getComplaintTemplateName(record);
      return resolvedName || letterCode;
    }

    if (letterCode === "ENDORSEMENT") {
      const resolvedName = getEndorsementTemplateName(record);
      return resolvedName || letterCode;
    }

    if (letterCode === "SINGLEDEBTORS") {
      const resolvedName = getSingleDebtorsTemplateName(record);
      return resolvedName || letterCode;
    }

    if (letterCode === "MULTIDEBTORS") {
      const resolvedName = getMultiDebtorsTemplateName(record);
      return resolvedName || letterCode;
    }

    return letterCode;
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

  const letterTemplates = Array.from(
    new Set(
      records
        .filter((record) => {
          const letterCode =
            typeof record["Letter_Code_"] === "string"
              ? record["Letter_Code_"].trim()
              : "";

          return !letterCodeFilter || letterCode === letterCodeFilter;
        })
        .map((record) => getTemplateVariantValue(record))
        .filter(Boolean)
    )
  ).sort();

  const filteredRecords = records.filter((record) => {
    const letterCode =
      typeof record["Letter_Code_"] === "string"
        ? record["Letter_Code_"].trim()
        : "";

    if (letterCodeFilter && letterCode !== letterCodeFilter) {
      return false;
    }

    const templateValue = getTemplateVariantValue(record);
    if (letterTemplateFilter && templateValue !== letterTemplateFilter) {
      return false;
    }

    return true;
  });

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setCurrentIndex(0);
      return;
    }

    if (currentIndex >= filteredRecords.length) {
      setCurrentIndex(filteredRecords.length - 1);
    }
  }, [filteredRecords.length, currentIndex]);

  const filteredRecord = filteredRecords[currentIndex] ?? null;
  const currentLetterCode =
    filteredRecord && typeof filteredRecord["Letter_Code_"] === "string"
      ? filteredRecord["Letter_Code_"].trim()
      : "";
  const currentLetterCodeKey = currentLetterCode.toUpperCase();
  const isOtherAssetsEligibleCode =
    currentLetterCodeKey === "COI" || currentLetterCodeKey === "RENEWAL";

  function normalizeFieldKey(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  }

  function findFirstStringValueByKey(obj: unknown, key: string): string {
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

    // Support XML where the logical field name is in an attribute, e.g.
    // <Field name="CancellationReason">PETDIED</Field>.
    const attributeNameValue =
      readFirstStringFromValue(record.name) ||
      readFirstStringFromValue(record.Name);

    if (attributeNameValue && normalizeFieldKey(attributeNameValue) === targetKey) {
      const preferredValue =
        readFirstStringFromValue(record.value) ||
        readFirstStringFromValue(record.Value);

      if (preferredValue) {
        return preferredValue;
      }

      for (const [recordKey, recordValue] of Object.entries(record)) {
        const normalizedRecordKey = normalizeFieldKey(recordKey);
        if (normalizedRecordKey === "name" || normalizedRecordKey === "value") {
          continue;
        }

        const candidate = readFirstStringFromValue(recordValue);
        if (candidate) {
          return candidate;
        }
      }
    }

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

  const autoRenewal = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "Auto-Renewal")
    : "";

  const cancellationReason = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "CancellationReason")
    : "";

  const cancelWithCoolingPeriod = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "CancelWithCoolingPeriod") ||
      findFirstStringValueByKey(filteredRecord, "CancelWithinCoolingPeriod")
    : "";

  const cxPremiumDueDate = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "CXPremiumDueDate")
    : "";

  const taskSubcategoryCode = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "TaskSubcategoryCode")
    : "";

  const upmTrigger = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "UPMTriger") ||
      findFirstStringValueByKey(filteredRecord, "UPMTrigger")
    : "";

  const idrDelayReason = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "IDRDelayReason")
    : "";

  const renewalLetterType = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "Letter_Type") ||
      findFirstStringValueByKey(filteredRecord, "LetterType")
    : "";

  const renewalLetterReasonCode = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "LetterReasonCode")
    : "";

  const clientNumberType = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "ClientNumberGroup.ClientNumberType") ||
      findFirstStringValueByKey(filteredRecord, "ClientNumberType")
    : "";

  const rejectionCount = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "RejectionCount") ||
      findFirstStringValueByKey(filteredRecord, "Rejection_Count") ||
      findFirstStringValueByKey(filteredRecord, "Rejection Count")
    : "";

  const portalBrand = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "PortalBrand") ||
      findFirstStringValueByKey(filteredRecord, "Portal_Brand") ||
      findFirstStringValueByKey(filteredRecord, "Portal Brand")
    : "";

  // Visibility context values - extracted from XML for content block filtering
  const letterType = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "Letter_Type") ||
      findFirstStringValueByKey(filteredRecord, "LetterType")
    : "";

  const qapiVersion = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "QAPIVersion") ||
      findFirstStringValueByKey(filteredRecord, "QAPI_Version")
    : "";

  const routineCare = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "RoutineCare")
    : "";

  const boosterCare = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "BoosterCare")
    : "";

  const paymentPeriod = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "PaymentPeriod")
    : "";

  const installmentCollectionFeeBase = filteredRecord
    ? findFirstStringValueByKey(filteredRecord, "InstallmentCollectionFeeBase")
    : "";

  const activeContent = useMemo(() => {
    return usePreviewContent ? draftContent : publishedContent;
  }, [usePreviewContent, draftContent, publishedContent]);

  const resolvedDraftHtml = useMemo(() => {
    if (!draftContent.html) {
      return "";
    }

    return replaceCmsPlaceholders(
      draftContent.html,
      filteredRecord,
      draftContent.brandPartner,
      showResolvedCmsValues,
      highlightCmsPlaceholders
    );
  }, [draftContent.html, draftContent.brandPartner, filteredRecord, showResolvedCmsValues, highlightCmsPlaceholders]);

  const resolvedPublishedHtml = useMemo(() => {
    if (!publishedContent.html) {
      return "";
    }

    return replaceCmsPlaceholders(
      publishedContent.html,
      filteredRecord,
      publishedContent.brandPartner,
      showResolvedCmsValues,
      highlightCmsPlaceholders
    );
  }, [publishedContent.html, publishedContent.brandPartner, filteredRecord, showResolvedCmsValues, highlightCmsPlaceholders]);

  const highlightedCmsHtml = useMemo(() => {
    // Compare mode highlights only changed Draft text against Published baseline.
    if (usePreviewContent && comparePublishedToDraft) {
      return highlightAddedRichText(resolvedPublishedHtml, resolvedDraftHtml);
    }

    if (usePreviewContent) {
      return resolvedDraftHtml;
    }

    // Published mode renders published content without Draft comparison highlights.
    return resolvedPublishedHtml;
  }, [usePreviewContent, comparePublishedToDraft, resolvedDraftHtml, resolvedPublishedHtml]);

  useEffect(() => {
    const loadCmsContent = async () => {
      if (!currentLetterCode) {
        setCmsLoading(false);
        setCmsErrorMessage(null);
        setCmsNoticeMessage(null);
        setCmsNotConfigured(false);
        setDraftContent({ title: "", html: "", raw: null, brandPartner: null });
        setPublishedContent({ title: "", html: "", raw: null, brandPartner: null });
        setOtherAssetsOptions([]);
        setSelectedOtherAssetsCodename("");
        return;
      }

      if (!isOtherAssetsEligibleCode) {
        setOtherAssetsOptions([]);
        setSelectedOtherAssetsCodename("");
      }

      // Detect record-level navigation vs. user selection change.
      // Build a key from all deps except selectedOtherAssetsCodename.
      const recordKey = [
        currentLetterCode, partnerName, waiverOutcome, underwriter, autoRenewal,
        cancellationReason, cancelWithCoolingPeriod, cxPremiumDueDate,
        taskSubcategoryCode, upmTrigger, idrDelayReason, renewalLetterType, renewalLetterReasonCode,
      ].join("|");
      const isRecordChange = recordKey !== coiRecordKeyRef.current;
      coiRecordKeyRef.current = recordKey;
      // On record navigation clear stale Other Assets state immediately.
      if (isRecordChange && isOtherAssetsEligibleCode) {
        setOtherAssetsOptions([]);
        setSelectedOtherAssetsCodename("");
      }
      const effectiveOtherAssetsCodename = isRecordChange ? "" : selectedOtherAssetsCodename;

      setCmsLoading(true);
      setCmsErrorMessage(null);
      setCmsNoticeMessage(null);
      setCmsNotConfigured(false);
      setDraftContent({ title: "", html: "", raw: null, brandPartner: null });
      setPublishedContent({ title: "", html: "", raw: null, brandPartner: null });

      try {
        const buildBaseParams = () => {
          const params = new URLSearchParams({
            letterCode: currentLetterCode,
          });

          if (waiverOutcome) {
            params.set("waiverOutcome", waiverOutcome);
          }

          if (partnerName) {
            params.set("partnerName", partnerName);
          }

          if (underwriter) {
            params.set("underwriter", underwriter);
          }

          if (autoRenewal) {
            params.set("autoRenewal", autoRenewal);
          }

          if (cancellationReason) {
            params.set("cancellationReason", cancellationReason);
          }

          if (cancelWithCoolingPeriod) {
            params.set("cancelWithCoolingPeriod", cancelWithCoolingPeriod);
          }

          if (cxPremiumDueDate) {
            params.set("cxPremiumDueDate", cxPremiumDueDate);
          }

          if (taskSubcategoryCode) {
            params.set("taskSubcategoryCode", taskSubcategoryCode);
          }

          if (upmTrigger) {
            params.set("upmTrigger", upmTrigger);
          }

          if (idrDelayReason) {
            params.set("idrDelayReason", idrDelayReason);
          }

          if (renewalLetterType) {
            params.set("letterType", renewalLetterType);
          } else if (letterType) {
            params.set("letterType", letterType);
          }

          if (renewalLetterReasonCode) {
            params.set("letterReasonCode", renewalLetterReasonCode);
          }

          if (clientNumberType) {
            params.set("clientNumberType", clientNumberType);
          }

          if (rejectionCount) {
            params.set("rejectionCount", rejectionCount);
          }

          if (portalBrand) {
            params.set("portalBrand", portalBrand);
          }

          if (isOtherAssetsEligibleCode && effectiveOtherAssetsCodename) {
            params.set("otherAssetsCodename", effectiveOtherAssetsCodename);
          }

          // Visibility context parameters for content block filtering
          if (letterType) {
            params.set("letterTypeForVisibility", letterType);
          }

          if (qapiVersion) {
            params.set("qapiVersion", qapiVersion);
          }

          if (routineCare) {
            params.set("routineCare", routineCare);
          }

          if (boosterCare) {
            params.set("boosterCare", boosterCare);
          }

          if (paymentPeriod) {
            params.set("paymentPeriod", paymentPeriod);
          }

          if (installmentCollectionFeeBase) {
            params.set("installmentCollectionFeeBase", installmentCollectionFeeBase);
          }

          return params;
        };

        const fetchByMode = async (isPreview: boolean): Promise<CmsVersionState> => {
          const queryParams = buildBaseParams();
          queryParams.set("usePreview", isPreview ? "true" : "false");

          const response = await fetch(`/api/kontent-letter?${queryParams.toString()}`);
          const responseText = await response.text();
          let payload: {
            error?: string;
            title?: string;
            html?: string;
            raw?: unknown;
            brandPartner?: BrandPartnerData | null;
            otherAssetsOptions?: OtherAssetsOption[];
            selectedOtherAssetsCodename?: string;
          } = {};

          if (responseText.trim()) {
            try {
              payload = JSON.parse(responseText) as typeof payload;
            } catch {
              const modeLabel = isPreview ? "Draft" : "Published";
              const modeError = new Error(
                `${modeLabel} content endpoint returned a non-JSON response (${response.status}).`
              ) as Error & { status?: number };
              modeError.status = response.status;
              throw modeError;
            }
          }

          if (!response.ok) {
            const modeError = new Error(payload.error || `Unable to load CMS content (${response.status}).`) as Error & {
              status?: number;
            };
            modeError.status = response.status;
            throw modeError;
          }

          return {
            title: payload.title || currentLetterCode,
            html: payload.html || "",
            raw: payload.raw ?? null,
            brandPartner: payload.brandPartner ?? null,
            otherAssetsOptions: payload.otherAssetsOptions ?? [],
            selectedOtherAssetsCodename: payload.selectedOtherAssetsCodename ?? "",
          };
        };

        const [draftResult, publishedResult] = await Promise.allSettled([
          fetchByMode(true),
          fetchByMode(false),
        ]);

        if (draftResult.status === "fulfilled") {
          setDraftContent(draftResult.value);
          if (isOtherAssetsEligibleCode) {
            setOtherAssetsOptions(draftResult.value.otherAssetsOptions ?? []);
            setSelectedOtherAssetsCodename(
              draftResult.value.selectedOtherAssetsCodename ?? ""
            );
          }
        }

        if (publishedResult.status === "fulfilled") {
          setPublishedContent(publishedResult.value);
        }

        if (draftResult.status === "rejected" && publishedResult.status === "rejected") {
          const draftStatus =
            draftResult.reason && typeof draftResult.reason === "object" && "status" in draftResult.reason
              ? Number((draftResult.reason as { status?: unknown }).status)
              : undefined;
          const publishedStatus =
            publishedResult.reason && typeof publishedResult.reason === "object" && "status" in publishedResult.reason
              ? Number((publishedResult.reason as { status?: unknown }).status)
              : undefined;

          setCmsNotConfigured(draftStatus === 404 && publishedStatus === 404);
          setCmsErrorMessage(
            [
              draftResult.reason instanceof Error ? `Draft: ${draftResult.reason.message}` : "Draft fetch failed.",
              publishedResult.reason instanceof Error ? `Published: ${publishedResult.reason.message}` : "Published fetch failed.",
            ].join(" ")
          );
          return;
        }

        if (draftResult.status === "rejected" || publishedResult.status === "rejected") {
          setCmsNotConfigured(false);
          const partialMessage = draftResult.status === "rejected"
            ? "Draft content unavailable; showing published content."
            : "Published content unavailable; showing draft content without cross-version comparison.";
          setCmsNoticeMessage(partialMessage);
        }
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
  }, [
    currentLetterCode,
    waiverOutcome,
    partnerName,
    underwriter,
    autoRenewal,
    cancellationReason,
    cancelWithCoolingPeriod,
    cxPremiumDueDate,
    taskSubcategoryCode,
    upmTrigger,
    idrDelayReason,
    renewalLetterType,
    renewalLetterReasonCode,
    clientNumberType,
    selectedOtherAssetsCodename,
    isOtherAssetsEligibleCode,
    letterType,
    qapiVersion,
    routineCare,
    boosterCare,
    paymentPeriod,
    installmentCollectionFeeBase,
  ]);

  const cmsLetterLogoSrc = activeContent.brandPartner?.logoUrl || fallbackLogoSrc;
  const cmsLetterLogoAlt = activeContent.brandPartner?.partnerName || "Brand Partner Logo";
  const cmsBrandColor = normalizeHexColor(activeContent.brandPartner?.primaryColorHex) || "#e5e7eb";
  const cmsLetterLayerBackground = cmsBrandColor;
  const cmsFrameTextColor = getContrastTextColor(cmsBrandColor);
  const cmsFrameMutedTextColor = cmsFrameTextColor === "#ffffff" ? "#f3f4f6" : "#374151";
  const cmsFrameErrorColor = cmsFrameTextColor === "#ffffff" ? "#fecaca" : "#b00020";
  const cmsTemplateCanvasBackground = "#ffffff";
  const cmsTemplateCanvasTextColor = "#1f2937";

  return (
    <main className="app-shell">
      <header className="app-hero">
        <div>
          <p className="app-hero__eyebrow">XML to CMS preview</p>
          <h1 className="app-hero__title">Comms Live Preview</h1>
        </div>
      </header>

      <section className="workspace-grid">
        <article
          className="panel panel--brand"
          style={{
            gridColumn: "2",
            gridRow: "1",
            minWidth: 0,
            backgroundColor: cmsLetterLayerBackground,
            color: cmsFrameTextColor,
          }}
        >
          <div className="panel__header">
            <p className="panel__eyebrow" style={{ color: cmsFrameMutedTextColor }}>
              Rendered output
            </p>
            <h2 className="panel__title" style={{ color: cmsFrameTextColor }}>
              CMS Letter Content
            </h2>
            <p className="panel__description" style={{ color: cmsFrameMutedTextColor }}>
              Draft / published content, optional comparison highlighting, and record-specific Other Assets.
            </p>
          </div>

          <div className="panel__body panel__body--compact">
          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showResolvedCmsValues}
                onChange={(event) => setShowResolvedCmsValues(event.target.checked)}
              />
              {showResolvedCmsValues ? "Showing XML values" : "Showing placeholders"}
            </label>

            <label className="toggle">
              <input
                type="checkbox"
                checked={highlightCmsPlaceholders}
                onChange={(event) => setHighlightCmsPlaceholders(event.target.checked)}
              />
              Highlight Dynamic tags
            </label>

            <div className="control-group" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label htmlFor="content-mode-select" className="field__label" style={{ margin: 0 }}>
                Content Mode:
              </label>
              <select
                id="content-mode-select"
                value={usePreviewContent ? "draft" : "published"}
                onChange={(event) => setUsePreviewContent(event.target.value === "draft")}
                className="select"
              >
                <option value="draft">Draft Content</option>
                <option value="published">Published Content</option>
              </select>
            </div>

            {currentLetterCode && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={comparePublishedToDraft}
                  onChange={(event) => setComparePublishedToDraft(event.target.checked)}
                  disabled={!usePreviewContent}
                />
                Compare Published -&gt; Draft
              </label>
            )}
          </div>

          {currentLetterCode && !cmsLoading && !cmsErrorMessage && (
            <p className="helper-text" style={{ color: cmsFrameMutedTextColor, textAlign: "left" }}>
              {usePreviewContent && comparePublishedToDraft
                ? "Comparing Published -> Draft. Only changed Draft text is highlighted in green."
                : usePreviewContent
                  ? "Draft view without Published comparison highlighting."
                  : "Published view: highlights are disabled."}
            </p>
          )}

          {!currentLetterCode && (
            <p className="status" style={{ color: cmsFrameMutedTextColor }}>
              Load XML and select a record to render its letter content from Kontent.ai.
            </p>
          )}

          {currentLetterCode && (
            <p className="record-summary" style={{ color: cmsFrameMutedTextColor }}>
              Letter Code: <strong>{currentLetterCode}</strong>
            </p>
          )}

          {isOtherAssetsEligibleCode && !cmsLoading && otherAssetsOptions.length > 0 && (
            <div className="control-group">
              <label htmlFor="other-assets-select" className="field__label">
                Other Assets:
              </label>
              <select
                id="other-assets-select"
                value={selectedOtherAssetsCodename}
                onChange={(event) => setSelectedOtherAssetsCodename(event.target.value)}
                className="select"
              >
                {otherAssetsOptions.map((option) => (
                  <option key={option.codename} value={option.codename}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {cmsLoading && (
            <p className="status" style={{ color: cmsFrameMutedTextColor, textAlign: "left", alignSelf: "flex-start" }}>Loading CMS content...</p>
          )}

          {cmsErrorMessage && (
            <p className="status status--error" style={{ color: cmsFrameErrorColor, textAlign: "left", alignSelf: "flex-start" }}>
              Error: {cmsErrorMessage}
            </p>
          )}

          {cmsNoticeMessage && !cmsErrorMessage && (
            <p className="status status--notice" style={{ color: "#6b7280", textAlign: "left", alignSelf: "flex-start" }}>
              {cmsNoticeMessage}
            </p>
          )}

          {!cmsLoading && cmsNotConfigured && currentLetterCode && (
            <p className="status" style={{ color: cmsFrameMutedTextColor, textAlign: "left", alignSelf: "flex-start" }}>
              No template is configured in Kontent.ai for letter code
              {" "}
              <strong>{currentLetterCode}</strong>.
            </p>
          )}

          {!cmsLoading && !cmsErrorMessage && activeContent.title && (
            <h3 className="panel__title" style={{ color: cmsFrameTextColor, textAlign: "left", alignSelf: "flex-start", margin: 0, marginTop: "16px" }}>{activeContent.title}</h3>
          )}

          {!cmsLoading && !cmsErrorMessage && highlightedCmsHtml && (
            <section
              className="panel"
              style={{
                borderTop: `4px solid ${cmsBrandColor}`,
                backgroundColor: cmsTemplateCanvasBackground,
                color: cmsTemplateCanvasTextColor,
              }}
            >
              <div
                className="panel__body"
                style={{
                  backgroundColor: cmsTemplateCanvasBackground,
                  color: cmsTemplateCanvasTextColor,
                }}
              >
                <Image
                  src={cmsLetterLogoSrc}
                  alt={cmsLetterLogoAlt}
                  width={210}
                  height={45}
                  style={{ width: "min(100%, 210px)", height: "auto", objectFit: "contain" }}
                />
                <div className="cms-rich-text" dangerouslySetInnerHTML={{ __html: highlightedCmsHtml }} />

              {activeContent.brandPartner?.disclaimer && (
                <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: `1px solid ${cmsBrandColor}` }}>
                  <strong style={{ display: "block", marginBottom: "0.5rem", color: "inherit" }}>
                    Disclaimer:
                  </strong>
                  <div className="cms-rich-text" dangerouslySetInnerHTML={{ __html: activeContent.brandPartner.disclaimer }} />
                </div>
              )}
              </div>
            </section>
          )}

          {!cmsLoading && !cmsErrorMessage && !activeContent.html && activeContent.raw !== null && (
            <pre className="code-block">
              {JSON.stringify(activeContent.raw, null, 2)}
            </pre>
          )}
          </div>
        </article>

        <section className="workspace-column" style={{ gridColumn: "1", gridRow: "1" }}>
          <article className="panel">
            <div className="panel__header">
              <p className="panel__eyebrow">Input</p>
              <h2 className="panel__title">Load XML</h2>
              <p className="panel__description">Choose a file to populate the record navigator and preview.</p>
            </div>

            <section className="panel__body">
              <label htmlFor="xml-file" className="field__label">File path</label>
              <input
                id="xml-file"
                type="file"
                accept=".xml"
                onChange={handleLocalFileSelect}
                disabled={isLoading}
                style={{ display: "none" }}
              />
              <div className="file-row">
                <label
                  htmlFor="xml-file"
                  className="file-button file-button--primary"
                  aria-disabled={isLoading}
                  style={{ opacity: isLoading ? 0.6 : 1 }}
                >
                  Choose File
                </label>
                <span className={selectedFileName ? "file-name file-name--selected" : "file-name"}>
                  {selectedFileName || "No file selected"}
                </span>
              </div>

              <small className="helper-text">
                Select an XML file from your computer to preview the letter content.
              </small>

              {errorMessage && (
                <p className="status status--error">Error: {errorMessage}</p>
              )}
            </section>
          </article>

          <article className="panel">
            <div className="panel__header">
              <p className="panel__eyebrow">Records</p>
              <h2 className="panel__title">XML Record Panel</h2>
            </div>

            <div className="panel__body">

          {records.length > 0 && (
            <p className="record-summary">
              Loaded <strong>{records.length}</strong> record{records.length !== 1 ? "s" : ""}.
              {letterCodes.length > 0
                ? ` Letter codes found: ${letterCodes.join(", ")}.`
                : " No Letter_Code_ values detected in this XML."}
            </p>
          )}

          {records.length > 0 && (
            <section className="nav-row">
              {/* Letter type filter resets navigation index when changed */}
              <label htmlFor="letter-code-filter" className="field__label">
                Filter by Letter Type:
              </label>
              <select
                id="letter-code-filter"
                value={letterCodeFilter}
                onChange={(event) => {
                  setLetterCodeFilter(event.target.value);
                  setLetterTemplateFilter("");
                  setCurrentIndex(0);
                }}
                className="select"
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

          {letterTemplates.length > 0 && (
            <section className="nav-row">
              <label htmlFor="letter-template-filter" className="field__label">
                Filter by Letter Template:
              </label>
              <select
                id="letter-template-filter"
                value={letterTemplateFilter}
                onChange={(event) => {
                  setLetterTemplateFilter(event.target.value);
                  setCurrentIndex(0);
                }}
                className="select"
              >
                <option value="">All Templates ({letterTemplates.length})</option>
                {letterTemplates.map((template) => (
                  <option key={template} value={template}>
                    {getTemplateDisplayName(template)}
                  </option>
                ))}
              </select>
            </section>
          )}

          {filteredRecords.length > 0 && (
            <section className="nav-row">
              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => prev - 1)}
                disabled={currentIndex === 0 || isLoading}
                className="button button--secondary"
              >
                Previous
              </button>

              <button
                type="button"
                onClick={() => setCurrentIndex((prev) => prev + 1)}
                disabled={currentIndex === filteredRecords.length - 1 || isLoading}
                className="button button--secondary"
              >
                Next
              </button>

              <span className="nav-row__count">
                Record {currentIndex + 1} of {filteredRecords.length}
              </span>
            </section>
          )}

          {filteredRecords.length === 0 && records.length > 0 && (
            <p className="empty-state">
              No records match the selected letter type.
            </p>
          )}

            {filteredRecord !== null && (
              <section className="record-card">
              <h3 className="record-card__title">
                Record {currentIndex + 1} {" "}
                <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: "0.9rem" }}>
                  {String(filteredRecord["Letter_Code_"] ?? "Unknown letter type")}
                </span>
              </h3>

              {/* Letter envelope metadata: fields that sit directly on each Letter record */}
              <div className="record-meta">
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
                      <span className="record-meta__label">{key}</span>
                      <span className="record-meta__value">{String(filteredRecord[key])}</span>
                    </Fragment>
                  ) : null
                )}
              </div>

              {/* Letter_Data content: schema varies per Letter_Code_ */}
              {(() => {
                const letterData =
                  "Letter_Data" in filteredRecord
                    ? filteredRecord["Letter_Data"]
                    : filteredRecord;

                if (letterData === null || typeof letterData !== "object") {
                  return null;
                }

                return (
                  <>
                    <h4 className="panel__title" style={{ marginTop: 0, marginBottom: "0.4rem", fontSize: "0.95rem" }}>
                      Letter Data
                    </h4>
                    <pre className="code-block code-block--letter-data">
                      {JSON.stringify(letterData, null, 2)}
                    </pre>
                  </>
                );
              })()}
              </section>
            )}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
