import { NextResponse } from "next/server";

type KontentElement = {
  type?: string;
  value?: unknown;
};

type KontentItem = {
  system?: {
    codename?: string;
    name?: string;
    type?: string;
  };
  elements?: Record<string, KontentElement>;
};

type KontentDeliveryResponse = {
  items?: KontentItem[];
  modular_content?: Record<string, KontentItem>;
};

type BrandPartner = {
  name: string;
  codename: string;
  partnerName: string;
  logoUrl: string;
  primaryColorHex: string;
  disclaimer: string;
};

type ClWaiverConfig = {
  letterCode: string;
  selectorQueryParam: string;
};

type LetterCodeRule = {
  selectorQueryParam?: string;
  // When true, do not use rule hints to jump to another letter_type.
  requireExactLetterTypeMatch?: boolean;
  // When true, selector query value must exist (e.g. waiverOutcome).
  requireSelectorValue?: boolean;
  // When true, do not fall back to first linked template.
  disableDefaultTemplateFallback?: boolean;
  // When true, do not scan all letter_types for template-codename fallback.
  disableCrossLetterTypeFallback?: boolean;
  // Optional fallback hints when letter_type codename does not directly match XML letter code.
  letterTypeCodenames?: string[];
  letterTypeNames?: string[];
  // Map selector values (e.g. WaiverOutcome) to template codenames.
  valueToTemplateCodename?: Record<string, string>;
};

const LETTER_CODE_RULES: Record<string, LetterCodeRule> = {
  // Extend this object as you add mappings for additional Letter_Code_ values.
};

const CL_WAIVER_CONFIG: ClWaiverConfig = {
  letterCode: "CLWAIVER",
  selectorQueryParam: "waiverOutcome",
};

function readTextValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeCodeKey(value: string): string {
  // Normalize for resilient comparisons between XML codes and codenames.
  return normalizeCode(value).replace(/[^A-Z0-9]/g, "");
}

function readCodeFromElement(element?: KontentElement): string {
  if (!element) return "";
  const value = element.value;

  if (typeof value === "string") {
    return normalizeCode(value);
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return normalizeCode(value[0]);
  }

  return "";
}

function readStringElementValue(element?: KontentElement): string {
  if (!element) return "";

  const value = element.value;
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) {
        return entry.trim();
      }
    }
  }

  return "";
}

function readAssetUrl(element?: KontentElement): string {
  if (!element || !Array.isArray(element.value) || element.value.length === 0) {
    return "";
  }

  const first = element.value[0];
  if (first && typeof first === "object" && "url" in first) {
    const url = (first as { url?: unknown }).url;
    return typeof url === "string" ? url : "";
  }

  return "";
}

function readLinkedCodenames(element?: KontentElement): string[] {
  if (!element || !Array.isArray(element.value)) {
    return [];
  }

  return element.value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "codename" in entry) {
        const codename = (entry as { codename?: unknown }).codename;
        return typeof codename === "string" ? codename : "";
      }
      return "";
    })
    .filter((codename) => codename.length > 0);
}

function findMatchingLetterTypeItem(items: KontentItem[], letterCode: string): KontentItem | null {
  const normalizedCode = normalizeCode(letterCode);
  const normalizedCodeKey = normalizeCodeKey(letterCode);

  // Primary rule requested: match XML Letter_Code_ to `letter_type` item codename.
  const codenameMatch = items.find((item) => {
    if (item.system?.type !== "letter_type") {
      return false;
    }

    const codename = readTextValue(item.system?.codename);
    return codename.length > 0 && normalizeCodeKey(codename) === normalizedCodeKey;
  });

  if (codenameMatch) {
    return codenameMatch;
  }

  for (const item of items) {
    const isLetterType = item.system?.type === "letter_type";
    if (!isLetterType) {
      continue;
    }

    const elements = item.elements ?? {};
    const candidates = [
      readCodeFromElement(elements.letter_code),
      readCodeFromElement(elements.lettercode),
      readCodeFromElement(elements.code),
      readCodeFromElement(elements.letter_type),
      normalizeCode(readTextValue(item.system?.name)),
      normalizeCode(readTextValue(item.system?.codename)),
    ].filter((value) => value.length > 0);

    if (candidates.some((value) => value === normalizedCode)) {
      return item;
    }
  }

  return null;
}

function findLetterTypeByRule(items: KontentItem[], rule: LetterCodeRule): KontentItem | null {
  const candidates = items.filter((item) => item.system?.type === "letter_type");

  if (rule.letterTypeCodenames?.length) {
    const codenameKeys = rule.letterTypeCodenames.map((value) => normalizeCodeKey(value));
    const matchedByCodename = candidates.find((item) => {
      const codename = readTextValue(item.system?.codename);
      return codename.length > 0 && codenameKeys.includes(normalizeCodeKey(codename));
    });

    if (matchedByCodename) {
      return matchedByCodename;
    }
  }

  if (rule.letterTypeNames?.length) {
    const nameKeys = rule.letterTypeNames.map((value) => normalizeCodeKey(value));
    const matchedByName = candidates.find((item) => {
      const name = readTextValue(item.system?.name);
      return name.length > 0 && nameKeys.includes(normalizeCodeKey(name));
    });

    if (matchedByName) {
      return matchedByName;
    }
  }

  return null;
}

function extractContent(item: KontentItem): { title: string; html: string; raw: unknown } {
  const elements = item.elements ?? {};

  const title =
    readTextValue(elements.title?.value) ||
    readTextValue(elements.heading?.value) ||
    readTextValue(item.system?.name) ||
    "Letter Content";

  let html = "";

  for (const element of Object.values(elements)) {
    if (element.type === "rich_text" && typeof element.value === "string") {
      html = element.value;
      break;
    }
  }

  if (!html) {
    for (const element of Object.values(elements)) {
      if (typeof element.value === "string" && element.value.trim()) {
        html = `<p>${element.value}</p>`;
        break;
      }
    }
  }

  return {
    title,
    html,
    raw: item,
  };
}

async function fetchKontentItems(
  projectId: string,
  headers: Record<string, string>,
  apiHost: string
): Promise<KontentDeliveryResponse> {
  // Primary query: constrain to letter_type content items and include linked templates.
  const typedResponse = await fetch(
    `${apiHost}/${projectId}/items?system.type[eq]=letter_type&depth=10&limit=200`,
    {
      cache: "no-store",
      headers,
    }
  );

  if (typedResponse.ok) {
    return (await typedResponse.json()) as KontentDeliveryResponse;
  }

  // Fallback query for projects/endpoints where type filter syntax differs.
  const fallbackResponse = await fetch(
    `${apiHost}/${projectId}/items?depth=10&limit=200`,
    {
      cache: "no-store",
      headers,
    }
  );

  if (!fallbackResponse.ok) {
    throw new Error(`Failed to query Kontent.ai. Status: ${fallbackResponse.status}.`);
  }

  return (await fallbackResponse.json()) as KontentDeliveryResponse;
}

async function fetchBrandPartnerItems(
  projectId: string,
  headers: Record<string, string>,
  apiHost: string
): Promise<KontentDeliveryResponse> {
  const response = await fetch(
    `${apiHost}/${projectId}/items?system.type[eq]=brand_partner&depth=2&limit=200`,
    {
      cache: "no-store",
      headers,
    }
  );

  if (!response.ok) {
    return { items: [], modular_content: {} };
  }

  return (await response.json()) as KontentDeliveryResponse;
}

function resolveBrandPartner(
  partnerName: string,
  items: KontentItem[],
  modularContent: Record<string, KontentItem>,
  underwriter: string = ""
): BrandPartner | null {
  const normalizedPartner = normalizeCodeKey(partnerName);
  if (!normalizedPartner) {
    return null;
  }

  let partialMatch: KontentItem | null = null;

  for (const item of items) {
    const elements = item.elements ?? {};

    const partnerDisplayName =
      readStringElementValue(elements.data_macros___brand_partner__partnername) ||
      readTextValue(item.system?.name);

    const brandPartnerCode = readLinkedCodenames(elements.brand_partners)[0] || "";

    const candidates = [
      readTextValue(item.system?.codename),
      readTextValue(item.system?.name),
      partnerDisplayName,
      brandPartnerCode,
    ]
      .map((value) => normalizeCodeKey(value))
      .filter(Boolean);

    if (candidates.some((candidate) => candidate === normalizedPartner)) {
      // Extract linked disclaimer item based on underwriter value
      let disclaimerText = "";
      const disclaimerCodenamesLinked = readLinkedCodenames(elements.disclaimer);
      
      if (disclaimerCodenamesLinked.length > 0) {
        const disclaimerCodename = disclaimerCodenamesLinked[0];
        const disclaimerItem = modularContent[disclaimerCodename];
        
        if (disclaimerItem) {
          const disclaimerElements = disclaimerItem.elements ?? {};
          const normalizedUnderwriter = normalizeCode(underwriter).substring(0, 1);
          
          if (normalizedUnderwriter === "H") {
            // Look for Hollard Disclaimer field
            disclaimerText = 
              readStringElementValue(disclaimerElements.hollard_disclaimer) ||
              readStringElementValue(disclaimerElements.hollard__disclaimer) ||
              readStringElementValue(disclaimerElements.hollard);
          } else if (normalizedUnderwriter === "P") {
            // Look for PetSure Disclaimer field
            disclaimerText =
              readStringElementValue(disclaimerElements.petsure_disclaimer) ||
              readStringElementValue(disclaimerElements.petsure__disclaimer) ||
              readStringElementValue(disclaimerElements.petsure);
          }
        }
      }

      return {
        name: readTextValue(item.system?.name),
        codename: readTextValue(item.system?.codename),
        partnerName: partnerDisplayName,
        logoUrl: readAssetUrl(elements.logo),
        primaryColorHex: readStringElementValue(elements.primary_colour_hex_value),
        disclaimer: disclaimerText,
      };
    }

    if (!partialMatch) {
      const isPartial = candidates.some(
        (candidate) => candidate.includes(normalizedPartner) || normalizedPartner.includes(candidate)
      );
      if (isPartial) {
        partialMatch = item;
      }
    }
  }

  if (!partialMatch) {
    return null;
  }

  const elements = partialMatch.elements ?? {};
  
  // Extract linked disclaimer item for partial match too
  let disclaimerText = "";
  const disclaimerCodenamesLinked = readLinkedCodenames(elements.disclaimer);
  
  if (disclaimerCodenamesLinked.length > 0) {
    const disclaimerCodename = disclaimerCodenamesLinked[0];
    const disclaimerItem = modularContent[disclaimerCodename];
    
    if (disclaimerItem) {
      const disclaimerElements = disclaimerItem.elements ?? {};
      const normalizedUnderwriter = normalizeCode(underwriter).substring(0, 1);
      
      if (normalizedUnderwriter === "H") {
        disclaimerText =
          readStringElementValue(disclaimerElements.hollard_disclaimer) ||
          readStringElementValue(disclaimerElements.hollard__disclaimer) ||
          readStringElementValue(disclaimerElements.hollard);
      } else if (normalizedUnderwriter === "P") {
        disclaimerText =
          readStringElementValue(disclaimerElements.petsure_disclaimer) ||
          readStringElementValue(disclaimerElements.petsure__disclaimer) ||
          readStringElementValue(disclaimerElements.petsure);
      }
    }
  }
  
  return {
    name: readTextValue(partialMatch.system?.name),
    codename: readTextValue(partialMatch.system?.codename),
    partnerName:
      readStringElementValue(elements.data_macros___brand_partner__partnername) ||
      readTextValue(partialMatch.system?.name),
    logoUrl: readAssetUrl(elements.logo),
    primaryColorHex: readStringElementValue(elements.primary_colour_hex_value),
    disclaimer: disclaimerText,
  };
}

function resolveTemplateItem(
  letterTypeItem: KontentItem,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>
): KontentItem | null {
  const elements = letterTypeItem.elements ?? {};

  // The required model is `letter_type` containing linked items in `letter_templates`.
  const linkedTemplateCodenames = readLinkedCodenames(elements.letter_templates);

  if (linkedTemplateCodenames.length === 0) {
    return null;
  }

  for (const codename of linkedTemplateCodenames) {
    const fromModular = modularContent[codename];
    if (fromModular) {
      return fromModular;
    }

    const fromItems = allItems.find((item) => item.system?.codename === codename);
    if (fromItems) {
      return fromItems;
    }
  }

  return null;
}

function resolveTemplateByCodeAcrossLetterTypes(
  items: KontentItem[],
  modularContent: Record<string, KontentItem>,
  letterCode: string
): KontentItem | null {
  const normalizedCodeKey = normalizeCodeKey(letterCode);

  const letterTypeItems = items.filter((item) => item.system?.type === "letter_type");

  for (const letterTypeItem of letterTypeItems) {
    const elements = letterTypeItem.elements ?? {};
    const linkedTemplateCodenames = readLinkedCodenames(elements.letter_templates);

    for (const codename of linkedTemplateCodenames) {
      const normalizedTemplateCodeKey = normalizeCodeKey(codename);
      if (normalizedTemplateCodeKey !== normalizedCodeKey) {
        continue;
      }

      const fromModular = modularContent[codename];
      if (fromModular) {
        return fromModular;
      }

      const fromItems = items.find((item) => item.system?.codename === codename);
      if (fromItems) {
        return fromItems;
      }
    }
  }

  return null;
}

function resolveTemplateBySelector(
  letterTypeItem: KontentItem,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>,
  selectorValue: string,
  valueToTemplateCodename: Record<string, string> = {}
): KontentItem | null {
  if (!selectorValue.trim()) {
    return null;
  }

  const elements = letterTypeItem.elements ?? {};
  const linkedTemplateCodenames = readLinkedCodenames(elements.letter_templates);

  if (linkedTemplateCodenames.length === 0) {
    return null;
  }

  const normalizedSelectorKey = normalizeCodeKey(selectorValue);

  const mappedCodename = valueToTemplateCodename[normalizeCode(selectorValue)];
  const linkedCodeKeys = linkedTemplateCodenames.map((value) => normalizeCodeKey(value));

  if (mappedCodename && !linkedCodeKeys.includes(normalizeCodeKey(mappedCodename))) {
    return null;
  }

  if (mappedCodename) {
    const fromModular = modularContent[mappedCodename];
    if (fromModular) return fromModular;
    const fromItems = allItems.find((item) => item.system?.codename === mappedCodename);
    if (fromItems) return fromItems;
    return null;
  }

  for (const codename of linkedTemplateCodenames) {
    if (normalizeCodeKey(codename) !== normalizedSelectorKey) {
      continue;
    }

    const fromModular = modularContent[codename];
    if (fromModular) return fromModular;
    const fromItems = allItems.find((item) => item.system?.codename === codename);
    if (fromItems) return fromItems;
  }

  return null;
}

function resolveClWaiverTemplate(
  items: KontentItem[],
  modularContent: Record<string, KontentItem>,
  waiverOutcome: string
): { template: KontentItem | null; error?: string; status?: number } {
  if (!waiverOutcome.trim()) {
    return {
      template: null,
      error: "Missing required selector value 'waiverOutcome' for letter code CLWAIVER.",
      status: 400,
    };
  }

  const normalizedOutcome = normalizeCode(waiverOutcome);
  let resolved: KontentItem | null = null;

  for (const item of Object.values(modularContent)) {
    if (item.system?.type !== "letter_template") {
      continue;
    }

    const codename = readTextValue(item.system?.codename);
    if (codename && normalizeCodeKey(codename) === normalizeCodeKey(normalizedOutcome)) {
      resolved = item;
      break;
    }
  }

  if (!resolved) {
    resolved =
      items.find(
        (item) =>
          item.system?.type === "letter_template" &&
          normalizeCodeKey(readTextValue(item.system?.codename)) ===
            normalizeCodeKey(normalizedOutcome)
      ) || null;
  }

  if (!resolved) {
    return {
      template: null,
      error:
        `No CLWAIVER letter_template matched WaiverOutcome '${normalizedOutcome}'. ` +
        "Expected a letter_template codename equal to WaiverOutcome.",
      status: 404,
    };
  }

  return { template: resolved };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const letterCode = searchParams.get("letterCode");
  const underwriter = searchParams.get("underwriter") || "";
  const partnerName = searchParams.get("partnerName") || "";

  if (!letterCode) {
    return NextResponse.json({ error: "Missing letterCode query parameter." }, { status: 400 });
  }

  const projectId =
    process.env.KONTENT_PROJECT_ID ||
    process.env.NEXT_PUBLIC_KONTENT_PROJECT_ID ||
    process.env.KONTENT_ENVIRONMENT_ID ||
    process.env.NEXT_PUBLIC_KONTENT_ENVIRONMENT_ID;

  const deliveryApiKey =
    process.env.KONTENT_DELIVERY_API_KEY ||
    process.env.NEXT_PUBLIC_KONTENT_DELIVERY_API_KEY ||
    "";

  const previewApiKey =
    process.env.KONTENT_PREVIEW_API_KEY ||
    process.env.NEXT_PUBLIC_KONTENT_PREVIEW_API_KEY ||
    "";

  if (!projectId) {
    return NextResponse.json(
      {
        error:
          "Kontent environment/project ID is not configured. Set KONTENT_PROJECT_ID or NEXT_PUBLIC_KONTENT_ENVIRONMENT_ID.",
      },
      { status: 500 }
    );
  }

  try {
    const usePreview = Boolean(previewApiKey);
    const apiHost = usePreview
      ? "https://preview-deliver.kontent.ai"
      : "https://deliver.kontent.ai";
    const activeApiKey = usePreview ? previewApiKey : deliveryApiKey;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    // Use preview key when available so unpublished/current content is included.
    if (activeApiKey) {
      headers.Authorization = `Bearer ${activeApiKey}`;
    }

    const payload = await fetchKontentItems(projectId, headers, apiHost);
    const brandPartnerPayload = partnerName
      ? await fetchBrandPartnerItems(projectId, headers, apiHost)
      : { items: [], modular_content: {} };
    
    const resolvedBrandPartner = partnerName
      ? resolveBrandPartner(
          partnerName,
          Array.isArray(brandPartnerPayload.items) ? brandPartnerPayload.items : [],
          brandPartnerPayload.modular_content ?? {},
          underwriter
        )
      : null;

    const items = Array.isArray(payload.items) ? payload.items : [];
    const modularContent = payload.modular_content ?? {};
    const normalizedLetterCode = normalizeCode(letterCode);

    if (normalizedLetterCode === CL_WAIVER_CONFIG.letterCode) {
      const waiverOutcome =
        searchParams.get(CL_WAIVER_CONFIG.selectorQueryParam) || "";

      const clWaiverResult = resolveClWaiverTemplate(
        items,
        modularContent,
        waiverOutcome
      );

      if (!clWaiverResult.template) {
        return NextResponse.json(
          {
            error: clWaiverResult.error || "Unable to resolve CLWAIVER template.",
          },
          { status: clWaiverResult.status || 404 }
        );
      }

      const content = extractContent(clWaiverResult.template);
      return NextResponse.json(
        {
          ...content,
          brandPartner: resolvedBrandPartner,
        },
        { status: 200 }
      );
    }

    const rule = LETTER_CODE_RULES[normalizedLetterCode];
    const selectorValue =
      rule?.selectorQueryParam ? searchParams.get(rule.selectorQueryParam) || "" : "";

    const exactLetterTypeMatch = findMatchingLetterTypeItem(items, letterCode);
    const matchedLetterTypeItem =
      exactLetterTypeMatch ||
      (rule && !rule.requireExactLetterTypeMatch ? findLetterTypeByRule(items, rule) : null);

    if (!matchedLetterTypeItem && rule?.requireExactLetterTypeMatch) {
      return NextResponse.json(
        {
          error: `No exact letter_type content item found for letter code ${letterCode.toUpperCase()}.`,
        },
        { status: 404 }
      );
    }

    if (rule?.requireSelectorValue && !selectorValue.trim()) {
      return NextResponse.json(
        {
          error: `Missing required selector value '${rule.selectorQueryParam}' for letter code ${letterCode.toUpperCase()}.`,
        },
        { status: 400 }
      );
    }

    // Primary: match letter_type item by codename/fields and resolve its linked template.
    // Fallback: match directly against linked template codename across all letter_type items
    // (handles scenarios like XML code CLWAIVER and template codename clwaiver).
    let resolvedTemplate: KontentItem | null = null;

    if (matchedLetterTypeItem && selectorValue && rule) {
      resolvedTemplate = resolveTemplateBySelector(
        matchedLetterTypeItem,
        items,
        modularContent,
        selectorValue,
        rule.valueToTemplateCodename
      );
    }

    if (!resolvedTemplate && matchedLetterTypeItem && !rule?.disableDefaultTemplateFallback) {
      resolvedTemplate = resolveTemplateItem(matchedLetterTypeItem, items, modularContent);
    }

    if (!resolvedTemplate && !matchedLetterTypeItem && !rule?.disableCrossLetterTypeFallback) {
      resolvedTemplate = resolveTemplateByCodeAcrossLetterTypes(items, modularContent, letterCode);
    }

    if (!resolvedTemplate) {
      const baseError = matchedLetterTypeItem
        ? "Matched letter_type item does not have resolvable linked content in letter_templates."
        : `No letter_type content item found for letter code ${letterCode.toUpperCase()}.`;

      return NextResponse.json(
        {
          error: `${baseError} Also no linked letter_template item could be resolved for this selector value.`,
        },
        { status: 404 }
      );
    }

    const content = extractContent(resolvedTemplate);

    return NextResponse.json(
      {
        ...content,
        brandPartner: resolvedBrandPartner,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach Kontent.ai Delivery API.";
    return NextResponse.json(
      {
        error: message,
      },
      { status: 502 }
    );
  }
}
