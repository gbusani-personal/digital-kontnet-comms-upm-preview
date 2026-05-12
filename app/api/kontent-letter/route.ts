import { NextResponse } from "next/server";
import https from "https";
import { Resolver } from "dns";

// Node.js 24's built-in fetch uses undici (getaddrinfo) which fails in some
// network environments where the local router DNS does not respond to libuv
// UDP queries. This helper uses https.Agent with a custom lookup backed by an
// explicit DNS resolver (8.8.8.8 / 1.1.1.1) to work around that.

const _dnsResolver = new Resolver();
_dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

const _httpsAgent = new https.Agent({
  lookup(hostname, options, callback) {
    _dnsResolver.resolve4(hostname, (err, addrs) => {
      if (err) {
        callback(err as NodeJS.ErrnoException, "", 4);
        return;
      }
      if ((options as { all?: boolean })?.all) {
        (callback as (err: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void)(
          null,
          addrs.map((a) => ({ address: a, family: 4 }))
        );
      } else {
        callback(null, addrs[0], 4);
      }
    });
  },
});

type ApiFetchInit = {
  headers?: Record<string, string>;
  cache?: string;
};

type ApiFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

function apiFetch(url: string, init?: ApiFetchInit): Promise<ApiFetchResponse> {
  const parsed = new URL(url);
  const requestHeaders = init?.headers ?? {};

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : 443,
        path: parsed.pathname + parsed.search,
        method: "GET",
        agent: _httpsAgent,
        headers: requestHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(JSON.parse(body) as unknown),
            text: () => Promise.resolve(body),
          });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}


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

type OtherAssetsOption = {
  codename: string;
  name: string;
};

type ClWaiverConfig = {
  letterCode: string;
  selectorQueryParam: string;
};

type CancelConfig = {
  letterCode: string;
  cancellationReasonParam: string;
  cancelWithCoolingPeriodParam: string;
  cancelWithinCoolingPeriodParam: string;
  cxPremiumDueDateParam: string;
};

type ComplaintConfig = {
  letterCode: string;
  taskSubcategoryCodeParam: string;
  upmTriggerParam: string;
  idrDelayReasonParam: string;
};

type CoiConfig = {
  letterCode: string;
  requiredSpaceCodename: string;
  requiredTemplateNameFragment: string;
};

type RenewalConfig = {
  letterCode: string;
  letterTypeParam: string;
  letterReasonCodeParam: string;
  partnerNameParam: string;
};

type SingleTemplateLetterConfig = {
  letterCode: string;
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
  // ENDORSEMENT uses XML <Auto-Renewal> to select a linked template codename.
  ENDORSEMENT: {
    selectorQueryParam: "autoRenewal",
    requireSelectorValue: true,
    disableDefaultTemplateFallback: true,
  },
  // Extend this object as you add mappings for additional Letter_Code_ values.
};

const CL_WAIVER_CONFIG: ClWaiverConfig = {
  letterCode: "CLWAIVER",
  selectorQueryParam: "waiverOutcome",
};

const CANCEL_CONFIG: CancelConfig = {
  letterCode: "CANCEL",
  cancellationReasonParam: "cancellationReason",
  cancelWithCoolingPeriodParam: "cancelWithCoolingPeriod",
  cancelWithinCoolingPeriodParam: "cancelWithinCoolingPeriod",
  cxPremiumDueDateParam: "cxPremiumDueDate",
};

const COMPLAINT_CONFIG: ComplaintConfig = {
  letterCode: "COMPLAINT",
  taskSubcategoryCodeParam: "taskSubcategoryCode",
  upmTriggerParam: "upmTrigger",
  idrDelayReasonParam: "idrDelayReason",
};

const COI_CONFIG: CoiConfig = {
  letterCode: "COI",
  requiredSpaceCodename: "COI",
  requiredTemplateNameFragment: "NEW BUSINESS",
};

const RENEWAL_CONFIG: RenewalConfig = {
  letterCode: "RENEWAL",
  letterTypeParam: "letterType",
  letterReasonCodeParam: "letterReasonCode",
  partnerNameParam: "partnerName",
};

const SINGLE_TEMPLATE_LETTER_CONFIGS: SingleTemplateLetterConfig[] = [
  { letterCode: "DDMANDATE" },
  { letterCode: "ADHOCPAYMENTS" },
];

const SINGLE_TEMPLATE_LETTER_CODE_KEYS = new Set(
  SINGLE_TEMPLATE_LETTER_CONFIGS.map((config) => normalizeCodeKey(config.letterCode))
);

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

function normalizeAlphabeticKey(value: string): string {
  // Relaxed matcher for selector values where CMS codename may swap '-' and '_'
  // or contain other separators; keep only letters for matching.
  return normalizeCode(value).replace(/[^A-Z]/g, "");
}

function matchesSelectorValueToCodename(selectorValue: string, codename: string): boolean {
  const strictSelectorKey = normalizeCodeKey(selectorValue);
  const strictCodenameKey = normalizeCodeKey(codename);

  if (strictSelectorKey && strictSelectorKey === strictCodenameKey) {
    return true;
  }

  const alphaSelectorKey = normalizeAlphabeticKey(selectorValue);
  const alphaCodenameKey = normalizeAlphabeticKey(codename);

  return Boolean(alphaSelectorKey && alphaSelectorKey === alphaCodenameKey);
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

function readLinkedTemplateCodenames(elements: Record<string, KontentElement>): string[] {
  const orderedKeys = [
    "letter_templates",
    "letter_template",
    "templates",
    "template",
  ];

  const allKeys = Array.from(
    new Set([
      ...orderedKeys,
      ...Object.keys(elements),
    ])
  );

  const codenames: string[] = [];

  for (const key of allKeys) {
    const linked = readLinkedCodenames(elements[key]);
    if (linked.length === 0) {
      continue;
    }

    for (const codename of linked) {
      if (!codenames.includes(codename)) {
        codenames.push(codename);
      }
    }
  }

  return codenames;
}

function readSpaceCodenamesFromLetterType(item: KontentItem): string[] {
  const elements = item.elements ?? {};

  return [
    ...readLinkedCodenames(elements.space),
    ...readLinkedCodenames(elements.spaces),
    ...readLinkedCodenames(elements.letter_space),
    ...readLinkedCodenames(elements.letter_spaces),
  ];
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

    if (
      candidates.some(
        (value) =>
          value === normalizedCode ||
          normalizeCodeKey(value) === normalizedCodeKey
      )
    ) {
      return item;
    }
  }

  return null;
}

function findSingleTemplateLetterTypeItem(items: KontentItem[], letterCode: string): KontentItem | null {
  const strictMatch = findMatchingLetterTypeItem(items, letterCode);
  if (strictMatch) {
    return strictMatch;
  }

  const normalizedCodeKey = normalizeCodeKey(letterCode);

  for (const item of items) {
    if (item.system?.type !== "letter_type") {
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
    ]
      .map((value) => normalizeCodeKey(value))
      .filter(Boolean);

    const isLooseMatch = candidates.some(
      (candidate) =>
        candidate.includes(normalizedCodeKey) ||
        normalizedCodeKey.includes(candidate)
    );

    if (isLooseMatch) {
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

function readItemByCodename(
  codename: string,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>
): KontentItem | null {
  const fromModular = modularContent[codename];
  if (fromModular) {
    return fromModular;
  }

  return allItems.find((item) => readTextValue(item.system?.codename) === codename) || null;
}

function extractFirstHtmlFromItem(item: KontentItem): string {
  const elements = item.elements ?? {};

  for (const element of Object.values(elements)) {
    if (element.type === "rich_text" && typeof element.value === "string") {
      return element.value;
    }
  }

  for (const element of Object.values(elements)) {
    if (typeof element.value === "string" && element.value.trim()) {
      return `<p>${element.value}</p>`;
    }
  }

  return "";
}

function resolveReusableBlocks(
  html: string,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>,
  visitedCodenames: Set<string>
): string {
  if (!html.trim()) {
    return html;
  }

  return html.replace(/<object\b[^>]*><\/object>/gi, (objectTag) => {
    const codenameMatch = objectTag.match(/data-codename\s*=\s*["']([^"']+)["']/i);
    const codename = codenameMatch?.[1]?.trim() || "";

    if (!codename) {
      return "";
    }

    const normalizedCodename = normalizeCodeKey(codename);
    if (visitedCodenames.has(normalizedCodename)) {
      return "";
    }

    const linkedItem = readItemByCodename(codename, allItems, modularContent);
    if (!linkedItem) {
      return "";
    }

    const nextVisited = new Set(visitedCodenames);
    nextVisited.add(normalizedCodename);

    const linkedHtml = extractFirstHtmlFromItem(linkedItem);
    return resolveReusableBlocks(linkedHtml, allItems, modularContent, nextVisited);
  });
}

function extractContent(
  item: KontentItem,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>
): { title: string; html: string; raw: unknown } {
  const elements = item.elements ?? {};

  const title =
    readTextValue(elements.title?.value) ||
    readTextValue(elements.heading?.value) ||
    readTextValue(item.system?.name) ||
    "Letter Content";

  const initialHtml = extractFirstHtmlFromItem(item);
  const visitedCodenames = new Set<string>();
  const itemCodename = readTextValue(item.system?.codename);
  if (itemCodename) {
    visitedCodenames.add(normalizeCodeKey(itemCodename));
  }
  const html = resolveReusableBlocks(initialHtml, allItems, modularContent, visitedCodenames);

  return {
    title,
    html,
    raw: item,
  };
}

function readTemplateDisplayName(item: KontentItem): string {
  const elements = item.elements ?? {};

  return (
    readStringElementValue(elements.title) ||
    readStringElementValue(elements.heading) ||
    readStringElementValue(elements.template_name) ||
    readStringElementValue(elements.letter_template_name) ||
    readStringElementValue(elements.name) ||
    readTextValue(item.system?.name) ||
    readTextValue(item.system?.codename) ||
    "Letter Template"
  );
}

function isExcludedOtherAssetsTemplate(item: KontentItem): boolean {
  const elements = item.elements ?? {};
  const candidateValues = [
    readTextValue(item.system?.name),
    readTextValue(item.system?.codename),
    readStringElementValue(elements.title),
    readStringElementValue(elements.heading),
    readStringElementValue(elements.template_name),
    readStringElementValue(elements.letter_template_name),
    readStringElementValue(elements.name),
  ].map((value) => normalizeCodeKey(value));

  return candidateValues.some(
    (value) => value.includes("COJOBRIEF") || value.includes("ATTACHMENTS")
  );
}

async function fetchKontentItems(
  projectId: string,
  headers: Record<string, string>,
  apiHost: string
): Promise<KontentDeliveryResponse> {
  // Primary query: constrain to letter_type content items and include linked templates.
  const typedResponse = await apiFetch(
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
  const fallbackResponse = await apiFetch(
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
  const response = await apiFetch(
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

async function fetchCoiSpaceItem(
  projectId: string,
  headers: Record<string, string>,
  apiHost: string,
  requiredSpaceCodename: string
): Promise<KontentItem | null> {
  // Step 1 hierarchy query: resolve the `space` item by codename/name = COI.
  // Some projects use different casing or do not support system.codename filter consistently,
  // so we query by type and match locally.
  const normalizedTarget = normalizeCodeKey(requiredSpaceCodename);

  const response = await apiFetch(
    `${apiHost}/${projectId}/items?system.type[eq]=space&limit=200`,
    {
      cache: "no-store",
      headers,
    }
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as KontentDeliveryResponse;
  const items = Array.isArray(payload.items) ? payload.items : [];

  const matchedSpace = items.find((item) => {
    const codename = readTextValue(item.system?.codename);
    const name = readTextValue(item.system?.name);

    return (
      normalizeCodeKey(codename) === normalizedTarget ||
      normalizeCodeKey(name) === normalizedTarget
    );
  });

  if (matchedSpace) {
    return matchedSpace;
  }

  // Final fallback: some models represent "space" with different content type names.
  const fallbackResponse = await apiFetch(
    `${apiHost}/${projectId}/items?limit=200`,
    {
      cache: "no-store",
      headers,
    }
  );

  if (!fallbackResponse.ok) {
    return null;
  }

  const fallbackPayload = (await fallbackResponse.json()) as KontentDeliveryResponse;
  const fallbackItems = Array.isArray(fallbackPayload.items) ? fallbackPayload.items : [];

  return (
    fallbackItems.find((item) => {
      const type = readTextValue(item.system?.type);
      const codename = readTextValue(item.system?.codename);
      const name = readTextValue(item.system?.name);

      if (!normalizeCodeKey(type).includes("SPACE")) {
        return false;
      }

      return (
        normalizeCodeKey(codename) === normalizedTarget ||
        normalizeCodeKey(name) === normalizedTarget
      );
    }) || null
  );
}

async function fetchCoiLetterTypes(
  projectId: string,
  headers: Record<string, string>,
  apiHost: string,
  brandPartnerName: string
): Promise<KontentDeliveryResponse> {
  // Step 2 hierarchy query: narrow to LetterType records, then filter by item name.
  const response = await apiFetch(
    `${apiHost}/${projectId}/items?system.type[eq]=letter_type&depth=10&limit=200`,
    {
      cache: "no-store",
      headers,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to query COI letter types. Status: ${response.status}.`);
  }

  const payload = (await response.json()) as KontentDeliveryResponse;
  const allItems = Array.isArray(payload.items) ? payload.items : [];
  const normalizedTarget = normalizeCodeKey(brandPartnerName);

  const matchedItems = allItems.filter((item) => {
    if (item.system?.type !== "letter_type") {
      return false;
    }

    const name = readTextValue(item.system?.name);
    return normalizeCodeKey(name) === normalizedTarget;
  });

  return {
    items: matchedItems,
    modular_content: payload.modular_content ?? {},
  };
}

function resolveCoiTemplate(
  letterTypeItem: KontentItem,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>,
  requiredTemplateNameFragment: string
): KontentItem | null {
  // Step 3 hierarchy query: from selected LetterType, find linked template by name contains "New Business".
  const linkedTemplateCodenames = readLinkedCodenames(letterTypeItem.elements?.letter_templates);

  if (linkedTemplateCodenames.length === 0) {
    return null;
  }

  const normalizedNameFragmentKey = normalizeCodeKey(requiredTemplateNameFragment);

  const matchesNewBusinessVariant = (value: string): boolean => {
    const normalizedValue = normalizeCodeKey(value);
    const acceptedVariants = [
      normalizedNameFragmentKey,
      normalizeCodeKey("newbusiness"),
      normalizeCodeKey("new business"),
      normalizeCodeKey("new_business"),
      normalizeCodeKey("new-business"),
    ];

    return acceptedVariants.some((variant) =>
      normalizedValue.includes(variant)
    );
  };

  // Highest-priority rule requested by QA: match linked template codename
  // containing "newbusiness" before considering other metadata fields.
  const codenameFirstMatch = linkedTemplateCodenames.find((codename) =>
    matchesNewBusinessVariant(codename)
  );

  if (codenameFirstMatch) {
    const codenameTemplate = readItemByCodename(codenameFirstMatch, allItems, modularContent);
    if (codenameTemplate) {
      return codenameTemplate;
    }
  }

  const readTemplateMatchCandidates = (template: KontentItem): string[] => {
    const elements = template.elements ?? {};

    return [
      readTextValue(template.system?.name),
      readTextValue(template.system?.codename),
      readStringElementValue(elements.title),
      readStringElementValue(elements.heading),
      readStringElementValue(elements.template_name),
      readStringElementValue(elements.letter_template_name),
      readStringElementValue(elements.name),
    ]
      .map((value) => normalizeCodeKey(value))
      .filter((value) => value.length > 0);
  };

  for (const codename of linkedTemplateCodenames) {
    const template = readItemByCodename(codename, allItems, modularContent);
    if (!template) {
      continue;
    }

    const candidateKeys = readTemplateMatchCandidates(template);
    if (candidateKeys.some((candidate) => matchesNewBusinessVariant(candidate))) {
      return template;
    }
  }

  return null;
}

function resolveRenewalTemplate(
  partnerLetterTypes: KontentItem[],
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>,
  letterType: string,
  letterReasonCode: string
): { template: KontentItem | null; expectedTemplateName?: string; error?: string; status?: number } {
  if (!letterType.trim()) {
    return {
      template: null,
      error: "Missing required selector value 'letterType' for letter code RENEWAL.",
      status: 400,
    };
  }

  const normalizedLetterType = normalizeCodeKey(letterType);
  const normalizedReasonCode = normalizeCodeKey(letterReasonCode);

  let expectedTemplateName = "";

  if (normalizedLetterType === "STANDARD") {
    if (!normalizedReasonCode) {
      return {
        template: null,
        error: "Missing required selector value 'letterReasonCode' for RENEWAL letterType Standard.",
        status: 400,
      };
    }
    if (normalizedReasonCode === "NOR") {
      expectedTemplateName = "AUTO RENEWAL";
    } else if (normalizedReasonCode === "FOR") {
      expectedTemplateName = "AUTO RENEWAL - FORCED";
    }
  } else if (normalizedLetterType === "RENEWALOFFER" || normalizedLetterType === "OFFER") {
    if (!normalizedReasonCode) {
      return {
        template: null,
        error: "Missing required selector value 'letterReasonCode' for RENEWAL letterType Renewal_Offer.",
        status: 400,
      };
    }
    if (normalizedReasonCode === "NOR") {
      expectedTemplateName = "RENEWAL OFFER";
    } else if (normalizedReasonCode === "FOR") {
      expectedTemplateName = "RENEWAL OFFER - FORCED";
    }
  } else if (normalizedLetterType === "RENEWALACCEPTED" || normalizedLetterType === "ACCEPTANCE") {
    expectedTemplateName = "RENEWAL ACCEPTANCE";
  }

  if (!expectedTemplateName) {
    return {
      template: null,
      error:
        `No RENEWAL template mapping found for Letter_Type '${letterType}' and LetterReasonCode '${letterReasonCode}'.`,
      status: 404,
    };
  }

  const expectedNameKey = normalizeCodeKey(expectedTemplateName);
  const acceptedExpectedKeys = [
    expectedNameKey,
    normalizeCodeKey(expectedTemplateName.replace(/\s+/g, "")),
    normalizeCodeKey(expectedTemplateName.replace(/\s+/g, "_")),
    normalizeCodeKey(expectedTemplateName.replace(/\s+/g, "-")),
  ];

  const readTemplateMatchCandidates = (template: KontentItem): string[] => {
    const elements = template.elements ?? {};

    return [
      readTextValue(template.system?.name),
      readTextValue(template.system?.codename),
      readStringElementValue(elements.title),
      readStringElementValue(elements.heading),
      readStringElementValue(elements.template_name),
      readStringElementValue(elements.letter_template_name),
      readStringElementValue(elements.name),
    ]
      .map((value) => normalizeCodeKey(value))
      .filter((value) => value.length > 0);
  };

  for (const partnerLetterType of partnerLetterTypes) {
    const linkedTemplateCodenames = readLinkedTemplateCodenames(partnerLetterType.elements ?? {});

    for (const codename of linkedTemplateCodenames) {
      const template = readTemplateByCodename(codename, allItems, modularContent);
      if (!template) {
        continue;
      }

      const candidateKeys = readTemplateMatchCandidates(template);
      const isMatch = candidateKeys.some((candidate) =>
        acceptedExpectedKeys.some(
          (expectedKey) => candidate.includes(expectedKey) || expectedKey.includes(candidate)
        )
      );

      if (isMatch) {
        return { template, expectedTemplateName };
      }
    }
  }

  const allTemplateItems = [
    ...Object.values(modularContent).filter((item) => item.system?.type === "letter_template"),
    ...allItems.filter((item) => item.system?.type === "letter_template"),
  ];

  const fallbackTemplate = allTemplateItems.find((template) => {
    const candidateKeys = readTemplateMatchCandidates(template);
    return candidateKeys.some((candidate) =>
      acceptedExpectedKeys.some(
        (expectedKey) => candidate.includes(expectedKey) || expectedKey.includes(candidate)
      )
    );
  });

  if (fallbackTemplate) {
    return { template: fallbackTemplate, expectedTemplateName };
  }

  return {
    template: null,
    expectedTemplateName,
    error:
      `No RENEWAL letter_template matched '${expectedTemplateName}' in the partner-matched letter_type links.`,
    status: 404,
  };
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
        primaryColorHex: 
          readStringElementValue(elements.primary_colour_hex_value) ||
          readStringElementValue(elements.primary_color_hex_value) ||
          readStringElementValue(elements.primary_color) ||
          readStringElementValue(elements.primary_colour_hex),
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
    primaryColorHex: 
      readStringElementValue(elements.primary_colour_hex_value) ||
      readStringElementValue(elements.primary_color_hex_value) ||
      readStringElementValue(elements.primary_color) ||
      readStringElementValue(elements.primary_colour_hex),
    disclaimer: disclaimerText,
  };
}

function resolveTemplateItem(
  letterTypeItem: KontentItem,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>
): KontentItem | null {
  const elements = letterTypeItem.elements ?? {};

  // Primary expected field is `letter_templates`, but some items may use alternate field codenames.
  const linkedTemplateCodenames = readLinkedTemplateCodenames(elements);

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
    const linkedTemplateCodenames = readLinkedTemplateCodenames(elements);

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

function resolveTemplateDirectlyByCode(
  items: KontentItem[],
  modularContent: Record<string, KontentItem>,
  letterCode: string
): KontentItem | null {
  const normalizedCodeKey = normalizeCodeKey(letterCode);
  if (!normalizedCodeKey) {
    return null;
  }

  const templateCandidates = [
    ...Object.values(modularContent),
    ...items,
  ].filter((item) => item.system?.type === "letter_template");

  const readCandidateKeys = (template: KontentItem): string[] => {
    const elements = template.elements ?? {};

    return [
      readTextValue(template.system?.codename),
      readTextValue(template.system?.name),
      readStringElementValue(elements.title),
      readStringElementValue(elements.heading),
      readStringElementValue(elements.template_name),
      readStringElementValue(elements.letter_template_name),
      readStringElementValue(elements.name),
      readCodeFromElement(elements.letter_code),
      readCodeFromElement(elements.lettercode),
      readCodeFromElement(elements.code),
      readCodeFromElement(elements.letter_type),
    ]
      .map((value) => normalizeCodeKey(value))
      .filter((value) => value.length > 0);
  };

  const exact = templateCandidates.find((template) =>
    readCandidateKeys(template).some((candidateKey) => candidateKey === normalizedCodeKey)
  );

  if (exact) {
    return exact;
  }

  return (
    templateCandidates.find((template) =>
      readCandidateKeys(template).some(
        (candidateKey) =>
          candidateKey.includes(normalizedCodeKey) ||
          normalizedCodeKey.includes(candidateKey)
      )
    ) || null
  );
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
  const linkedTemplateCodenames = readLinkedTemplateCodenames(elements);

  if (linkedTemplateCodenames.length === 0) {
    return null;
  }

  const mappedCodename = valueToTemplateCodename[normalizeCode(selectorValue)];
  const hasMappedCodenameLinked = linkedTemplateCodenames.some((linkedCodename) =>
    matchesSelectorValueToCodename(mappedCodename || "", linkedCodename)
  );

  if (mappedCodename && !hasMappedCodenameLinked) {
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
    if (!matchesSelectorValueToCodename(selectorValue, codename)) {
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
    if (codename && matchesSelectorValueToCodename(normalizedOutcome, codename)) {
      resolved = item;
      break;
    }
  }

  if (!resolved) {
    resolved =
      items.find(
        (item) =>
          item.system?.type === "letter_template" &&
          matchesSelectorValueToCodename(
            normalizedOutcome,
            readTextValue(item.system?.codename)
          )
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

function isNullLikeValue(value: string): boolean {
  const normalized = normalizeCodeKey(value);
  return !normalized || normalized === "NULL" || normalized === "NONE" || normalized === "NA";
}

function isYesValue(value: string): boolean {
  const normalized = normalizeCodeKey(value);
  return normalized === "YES" || normalized === "Y" || normalized === "TRUE" || normalized === "1";
}

function readTemplateByCodename(
  codename: string,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>
): KontentItem | null {
  const fromModular = modularContent[codename];
  if (fromModular) {
    return fromModular;
  }

  return allItems.find((item) => item.system?.codename === codename) || null;
}

function resolveCancelTemplate(
  letterTypeItem: KontentItem | null,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>,
  cancellationReason: string,
  cancelWithCoolingPeriod: string,
  cxPremiumDueDate: string
): { template: KontentItem | null; expectedTemplateCode?: string; error?: string; status?: number } {
  if (!cancellationReason.trim()) {
    return {
      template: null,
      error: "Missing required selector value 'cancellationReason' for letter code CANCEL.",
      status: 400,
    };
  }

  const reason = normalizeAlphabeticKey(cancellationReason);
  let expectedTemplateCode = "";

  if (reason === "PETDIED" || reason === "PETMISSING" || reason === "OTHER") {
    const reasonPrefixMap: Record<string, string> = {
      PETDIED: "PET_DIED",
      PETMISSING: "PET_MISSING",
      OTHER: "OTHER",
    };

    const prefix = reasonPrefixMap[reason];

    if (isYesValue(cancelWithCoolingPeriod)) {
      expectedTemplateCode = `${prefix}_COOLING_OFF_PERIOD`;
    } else if (isNullLikeValue(cxPremiumDueDate)) {
      expectedTemplateCode = `${prefix}_NO_PREMIUM_DUE`;
    } else {
      expectedTemplateCode = `${prefix}_PREMIUM_DUE`;
    }
  } else {
    const directReasonMap: Record<string, string> = {
      NONPAYMENT: "NON_PAYMENTS",
      POLICYINISSUED: "POLICY_IN_ISSUED",
      RENEWALLAPSED: "RENEWAL_LAPSED",
      RENEWALCANCELLEDANNUAL: "RENEWAL_CANCELLED_ANNUAL",
      RENEWALCANCELLEDINSTALMENT: "RENEWAL_CANCELLED_INSTALMENT",
    };

    expectedTemplateCode = directReasonMap[reason] || "";
  }

  if (!expectedTemplateCode) {
    return {
      template: null,
      error: `No CANCEL template mapping found for CancellationReason '${cancellationReason}'.`,
      status: 404,
    };
  }

  const linkedTemplateCodenames = letterTypeItem
    ? readLinkedTemplateCodenames(letterTypeItem.elements ?? {})
    : [];

  for (const codename of linkedTemplateCodenames) {
    if (!matchesSelectorValueToCodename(expectedTemplateCode, codename)) {
      continue;
    }

    const template = readTemplateByCodename(codename, allItems, modularContent);
    if (template) {
      return { template, expectedTemplateCode };
    }
  }

  const allTemplateItems = [
    ...Object.values(modularContent).filter((item) => item.system?.type === "letter_template"),
    ...allItems.filter((item) => item.system?.type === "letter_template"),
  ];

  const fallbackTemplate = allTemplateItems.find((item) => {
    const codename = readTextValue(item.system?.codename);
    return codename.length > 0 && matchesSelectorValueToCodename(expectedTemplateCode, codename);
  });

  if (fallbackTemplate) {
    return { template: fallbackTemplate, expectedTemplateCode };
  }

  return {
    template: null,
    expectedTemplateCode,
    error:
      `No CANCEL letter_template matched '${expectedTemplateCode}'. ` +
      "Expected a letter_template codename matching the configured CANCEL logic.",
    status: 404,
  };
}

function resolveComplaintTemplate(
  letterTypeItem: KontentItem | null,
  allItems: KontentItem[],
  modularContent: Record<string, KontentItem>,
  taskSubcategoryCode: string,
  upmTrigger: string,
  idrDelayReason: string
): { template: KontentItem | null; expectedTemplateCode?: string; error?: string; status?: number } {
  if (!taskSubcategoryCode.trim()) {
    return {
      template: null,
      error: "Missing required selector value 'taskSubcategoryCode' for letter code COMPLAINT.",
      status: 400,
    };
  }

  if (!upmTrigger.trim()) {
    return {
      template: null,
      error: "Missing required selector value 'upmTrigger' for letter code COMPLAINT.",
      status: 400,
    };
  }

  const normalizedTaskSubcategoryCode = normalizeCode(taskSubcategoryCode);
  const normalizedTrigger = normalizeCodeKey(upmTrigger);
  const isCstComplaint =
    normalizedTaskSubcategoryCode === "SCAT0314" ||
    normalizedTaskSubcategoryCode === "SCAT0117";
  const templatePrefix = isCstComplaint ? "CST" : "IDR";

  let expectedTemplateCode = "";

  if (normalizedTrigger === "FOLLOWUP") {
    expectedTemplateCode = `${templatePrefix}_FOLLOWUP`;
  } else if (normalizedTrigger === "DELAYED") {
    if (!idrDelayReason.trim()) {
      return {
        template: null,
        error:
          "Missing required selector value 'idrDelayReason' for COMPLAINT letters when upmTrigger is DELAYED.",
        status: 400,
      };
    }

    const normalizedDelayReason = normalizeCodeKey(idrDelayReason);
    const delayReasonToSuffix: Record<string, string> = {
      COMPLAINTNONRESPONSE: "COMPLAINT",
      COMPLEXCASE: "COMPLEX",
      HIGHCOMPLAINTVOLUMES: "HIGH",
      INFORMATIONREQUIREDFROMTHIRDPARTY: "INFORMATION",
    };

    const suffix = delayReasonToSuffix[normalizedDelayReason] || "";
    if (!suffix) {
      return {
        template: null,
        error: `No COMPLAINT template mapping found for IDRDelayReason '${idrDelayReason}'.`,
        status: 404,
      };
    }

    expectedTemplateCode = `${templatePrefix}_${suffix}`;
  } else {
    return {
      template: null,
      error:
        `No COMPLAINT template mapping found for UPMTrigger '${upmTrigger}'. ` +
        "Expected UPMTrigger to be FOLLOWUP or DELAYED.",
      status: 404,
    };
  }

  const linkedTemplateCodenames = letterTypeItem
    ? readLinkedTemplateCodenames(letterTypeItem.elements ?? {})
    : [];

  for (const codename of linkedTemplateCodenames) {
    if (!matchesSelectorValueToCodename(expectedTemplateCode, codename)) {
      continue;
    }

    const template = readTemplateByCodename(codename, allItems, modularContent);
    if (template) {
      return { template, expectedTemplateCode };
    }
  }

  const allTemplateItems = [
    ...Object.values(modularContent).filter((item) => item.system?.type === "letter_template"),
    ...allItems.filter((item) => item.system?.type === "letter_template"),
  ];

  const fallbackTemplate = allTemplateItems.find((item) => {
    const codename = readTextValue(item.system?.codename);
    return codename.length > 0 && matchesSelectorValueToCodename(expectedTemplateCode, codename);
  });

  if (fallbackTemplate) {
    return { template: fallbackTemplate, expectedTemplateCode };
  }

  return {
    template: null,
    expectedTemplateCode,
    error:
      `No COMPLAINT letter_template matched '${expectedTemplateCode}'. ` +
      "Expected a letter_template codename matching the configured COMPLAINT logic.",
    status: 404,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const letterCode = searchParams.get("letterCode");
  const usePreviewParam = searchParams.get("usePreview");
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
    // Component content (Brand Partners, Spaces, LetterTypes) always uses preview/draft for consistent resolution.
    const componentApiHost = "https://preview-deliver.kontent.ai";
    const componentApiKey = previewApiKey;

    if (!componentApiKey) {
      return NextResponse.json(
        {
          error: "Preview API key is not configured. Ensure NEXT_PUBLIC_KONTENT_PREVIEW_API_KEY is set.",
        },
        { status: 500 }
      );
    }

    const componentHeaders: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${componentApiKey}`,
    };

    // Letter Template content mode can be toggled between draft and published.
    let usePreview: boolean;
    if (usePreviewParam !== null) {
      usePreview = usePreviewParam === "true";
    } else {
      usePreview = Boolean(previewApiKey);
    }

    const templateApiHost = usePreview
      ? "https://preview-deliver.kontent.ai"
      : "https://deliver.kontent.ai";
    const templateApiKey = usePreview ? previewApiKey : deliveryApiKey;

    // Validate that the required API key is configured for the requested template mode.
    if (!templateApiKey) {
      const mode = usePreview ? "preview/draft" : "published/delivery";
      return NextResponse.json(
        {
          error: `${mode} API key is not configured for letter templates. Ensure both NEXT_PUBLIC_KONTENT_DELIVERY_API_KEY and NEXT_PUBLIC_KONTENT_PREVIEW_API_KEY are set.`,
        },
        { status: 500 }
      );
    }

    const templateHeaders: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${templateApiKey}`,
    };

    // Fetch Letter Template with content mode toggle.
    const payload = await fetchKontentItems(projectId, templateHeaders, templateApiHost);
    // Fetch component content (Brand Partners) from stable preview/draft endpoint.
    const brandPartnerPayload = partnerName
      ? await fetchBrandPartnerItems(projectId, componentHeaders, componentApiHost)
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

      const content = extractContent(clWaiverResult.template, items, modularContent);
      return NextResponse.json(
        {
          ...content,
          brandPartner: resolvedBrandPartner,
        },
        { status: 200 }
      );
    }

    if (SINGLE_TEMPLATE_LETTER_CODE_KEYS.has(normalizeCodeKey(normalizedLetterCode))) {
      const singleTemplateLetterType = findSingleTemplateLetterTypeItem(items, letterCode);

      let singleTemplate = singleTemplateLetterType
        ? resolveTemplateItem(singleTemplateLetterType, items, modularContent)
        : null;

      // Fallback for cases where the letter_type linkage is unavailable but a direct template match exists.
      if (!singleTemplate) {
        singleTemplate = resolveTemplateDirectlyByCode(items, modularContent, letterCode);
      }

      if (!singleTemplate) {
        return NextResponse.json(
          {
            error:
              `No linked letter_template was resolved for single-template letter code ${letterCode.toUpperCase()}.`,
          },
          { status: 404 }
        );
      }

      const content = extractContent(singleTemplate, items, modularContent);
      return NextResponse.json(
        {
          ...content,
          brandPartner: resolvedBrandPartner,
        },
        { status: 200 }
      );
    }

    if (normalizedLetterCode === COI_CONFIG.letterCode) {
      if (!partnerName.trim()) {
        return NextResponse.json(
          {
            error: "Missing required selector value 'partnerName' for letter code COI.",
          },
          { status: 400 }
        );
      }

      // COI hierarchy:
      // 1) Find Space by codename COI.
      // 2) Find LetterType where item name matches Brand Partner Name.
      // 3) From linked letter templates, choose item name containing "New Business".
      const coiSpaceItem = await fetchCoiSpaceItem(
        projectId,
        componentHeaders,
        componentApiHost,
        COI_CONFIG.requiredSpaceCodename
      );


      // Fetch all letter_type items and filter by partnerName dynamically.
      const allLetterTypePayload = await fetchKontentItems(projectId, componentHeaders, componentApiHost);
      const allLetterTypeItems = Array.isArray(allLetterTypePayload.items)
        ? allLetterTypePayload.items.filter((item) => item.system?.type === "letter_type")
        : [];
      const allModularContent = allLetterTypePayload.modular_content ?? {};
      const coiSpaceCodename = readTextValue(coiSpaceItem?.system?.codename);

      // Relaxed partner name matching: ignore case, spaces, dashes, underscores.
      const normalizeLoose = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const normalizedPartnerName = normalizeLoose(partnerName);

      const eligibleCoiLetterTypeItems = allLetterTypeItems.filter((item) => {
        const name = readTextValue(item.system?.name);
        if (normalizeLoose(name) !== normalizedPartnerName) {
          return false;
        }
        const linkedSpaceCodenames = readSpaceCodenamesFromLetterType(item);
        if (!coiSpaceCodename || linkedSpaceCodenames.length === 0) {
          return true;
        }
        return linkedSpaceCodenames.some(
          (codename) => normalizeCodeKey(codename) === normalizeCodeKey(coiSpaceCodename)
        );
      });

      if (eligibleCoiLetterTypeItems.length === 0) {
        return NextResponse.json(
          {
            error:
              `No COI LetterType item found where name matches Brand Partner '${partnerName}'.`,
          },
          { status: 404 }
        );
      }

      const combinedItems = [...allLetterTypeItems, ...items];
      const combinedModularContent = { ...allModularContent, ...modularContent };

      let coiTemplate: KontentItem | null = null;
      let matchedCoiLetterTypeItem: KontentItem | null = null;
      for (const letterTypeItem of eligibleCoiLetterTypeItems) {
        const template = resolveCoiTemplate(
          letterTypeItem,
          combinedItems,
          combinedModularContent,
          COI_CONFIG.requiredTemplateNameFragment
        );
        if (template) {
          coiTemplate = template;
          matchedCoiLetterTypeItem = letterTypeItem;
          break;
        }
      }

      if (!coiTemplate) {
        return NextResponse.json(
          {
            error:
              "No COI letter template found where template item name contains 'New Business'.",
          },
          { status: 404 }
        );
      }

      if (!matchedCoiLetterTypeItem) {
        return NextResponse.json(
          {
            error: "Unable to resolve matched COI LetterType item for dropdown options.",
          },
          { status: 500 }
        );
      }

      const defaultTemplateCodename = readTextValue(coiTemplate.system?.codename);
      const requestedOtherAssetsCodename = searchParams.get("otherAssetsCodename") || "";

      const linkedTemplateCodenames = readLinkedTemplateCodenames(
        matchedCoiLetterTypeItem.elements ?? {}
      );

      const otherAssetsOptions: OtherAssetsOption[] = [];
      const seenCodenames = new Set<string>();

      // Keep the currently matched template as the first dropdown option unless excluded.
      if (defaultTemplateCodename && !isExcludedOtherAssetsTemplate(coiTemplate)) {
        const normalizedCodename = normalizeCodeKey(defaultTemplateCodename);
        otherAssetsOptions.push({
          codename: defaultTemplateCodename,
          name: readTemplateDisplayName(coiTemplate),
        });
        seenCodenames.add(normalizedCodename);
      }

      // Add every linked template from the matched COI letter type item(s).
      for (const codename of linkedTemplateCodenames) {
        if (!codename) {
          continue;
        }
        const normalizedCodename = normalizeCodeKey(codename);
        if (seenCodenames.has(normalizedCodename)) {
          continue;
        }
        const template = readItemByCodename(codename, combinedItems, combinedModularContent);
        if (!template || isExcludedOtherAssetsTemplate(template)) {
          continue;
        }

        const resolvedCodename = readTextValue(template.system?.codename) || codename;
        otherAssetsOptions.push({
          codename: resolvedCodename,
          name: readTemplateDisplayName(template),
        });
        seenCodenames.add(normalizedCodename);
      }

      let selectedTemplate = coiTemplate;
      let selectedOtherAssetsCodename = "";

      if (otherAssetsOptions.length > 0) {
        const defaultOption = otherAssetsOptions.find(
          (option) => normalizeCodeKey(option.codename) === normalizeCodeKey(defaultTemplateCodename)
        );

        if (defaultOption) {
          selectedOtherAssetsCodename = defaultOption.codename;
        } else {
          const firstOption = otherAssetsOptions[0];
          selectedOtherAssetsCodename = firstOption.codename;
          const firstTemplate = readItemByCodename(
            firstOption.codename,
            combinedItems,
            combinedModularContent
          );
          if (firstTemplate) {
            selectedTemplate = firstTemplate;
          }
        }
      }

      const allowedOptionCodenames = new Set(
        otherAssetsOptions.map((option) => normalizeCodeKey(option.codename))
      );

      if (
        requestedOtherAssetsCodename &&
        allowedOptionCodenames.has(normalizeCodeKey(requestedOtherAssetsCodename)) &&
        normalizeCodeKey(requestedOtherAssetsCodename) !== normalizeCodeKey(selectedOtherAssetsCodename)
      ) {
        const overrideTemplate = readItemByCodename(
          requestedOtherAssetsCodename,
          combinedItems,
          combinedModularContent
        );
        if (overrideTemplate) {
          selectedTemplate = overrideTemplate;
          selectedOtherAssetsCodename = requestedOtherAssetsCodename;
        }
      }

      const content = extractContent(
        selectedTemplate,
        combinedItems,
        combinedModularContent
      );
      return NextResponse.json(
        {
          ...content,
          brandPartner: resolvedBrandPartner,
          otherAssetsOptions,
          selectedOtherAssetsCodename,
        },
        { status: 200 }
      );
    }

    if (normalizedLetterCode === RENEWAL_CONFIG.letterCode) {
      const renewalLetterType = searchParams.get(RENEWAL_CONFIG.letterTypeParam) || "";
      const renewalLetterReasonCode =
        searchParams.get(RENEWAL_CONFIG.letterReasonCodeParam) || "";
      const renewalPartnerName = searchParams.get(RENEWAL_CONFIG.partnerNameParam) || partnerName;

      if (!renewalPartnerName.trim()) {
        return NextResponse.json(
          {
            error: "Missing required selector value 'partnerName' for letter code RENEWAL.",
          },
          { status: 400 }
        );
      }

      const allLetterTypePayload = await fetchKontentItems(
        projectId,
        componentHeaders,
        componentApiHost
      );
      const allLetterTypeItems = Array.isArray(allLetterTypePayload.items)
        ? allLetterTypePayload.items.filter((item) => item.system?.type === "letter_type")
        : [];
      const allModularContent = allLetterTypePayload.modular_content ?? {};
      const combinedItems = [...allLetterTypeItems, ...items];
      const combinedModularContent = { ...allModularContent, ...modularContent };

      const normalizeLoose = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const normalizedPartnerName = normalizeLoose(renewalPartnerName);

      const partnerLetterTypeItems = allLetterTypeItems.filter((item) => {
        const elements = item.elements ?? {};
        const linkedBrandPartnerCode = readLinkedCodenames(elements.brand_partners)[0] || "";
        const partnerCandidates = [
          readTextValue(item.system?.name),
          readTextValue(item.system?.codename),
          readStringElementValue(elements.partner_name),
          readStringElementValue(elements.brand_partner_name),
          readStringElementValue(elements.data_macros___brand_partner__partnername),
          linkedBrandPartnerCode,
        ]
          .map((value) => normalizeLoose(value))
          .filter(Boolean);

        return partnerCandidates.some(
          (candidate) =>
            candidate === normalizedPartnerName ||
            candidate.includes(normalizedPartnerName) ||
            normalizedPartnerName.includes(candidate)
        );
      });

      if (partnerLetterTypeItems.length === 0) {
        return NextResponse.json(
          {
            error:
              `No RENEWAL LetterType item found where partner/name matches '${renewalPartnerName}'.`,
          },
          { status: 404 }
        );
      }

      const renewalResult = resolveRenewalTemplate(
        partnerLetterTypeItems,
        combinedItems,
        combinedModularContent,
        renewalLetterType,
        renewalLetterReasonCode
      );

      if (!renewalResult.template) {
        return NextResponse.json(
          {
            error: renewalResult.error || "Unable to resolve RENEWAL template.",
          },
          { status: renewalResult.status || 404 }
        );
      }

      const content = extractContent(
        renewalResult.template,
        combinedItems,
        combinedModularContent
      );

      return NextResponse.json(
        {
          ...content,
          brandPartner: resolvedBrandPartner,
        },
        { status: 200 }
      );
    }

    if (normalizedLetterCode === CANCEL_CONFIG.letterCode) {
      const cancellationReason =
        searchParams.get(CANCEL_CONFIG.cancellationReasonParam) || "";
      const cancelWithCoolingPeriod =
        searchParams.get(CANCEL_CONFIG.cancelWithCoolingPeriodParam) ||
        searchParams.get(CANCEL_CONFIG.cancelWithinCoolingPeriodParam) ||
        "";
      const cxPremiumDueDate =
        searchParams.get(CANCEL_CONFIG.cxPremiumDueDateParam) || "";

      const cancelLetterType = findMatchingLetterTypeItem(items, letterCode);

      const cancelResult = resolveCancelTemplate(
        cancelLetterType,
        items,
        modularContent,
        cancellationReason,
        cancelWithCoolingPeriod,
        cxPremiumDueDate
      );

      if (!cancelResult.template) {
        return NextResponse.json(
          {
            error: cancelResult.error || "Unable to resolve CANCEL template.",
          },
          { status: cancelResult.status || 404 }
        );
      }

      const content = extractContent(cancelResult.template, items, modularContent);
      return NextResponse.json(
        {
          ...content,
          brandPartner: resolvedBrandPartner,
        },
        { status: 200 }
      );
    }

    if (normalizedLetterCode === COMPLAINT_CONFIG.letterCode) {
      const taskSubcategoryCode =
        searchParams.get(COMPLAINT_CONFIG.taskSubcategoryCodeParam) || "";
      const upmTrigger = searchParams.get(COMPLAINT_CONFIG.upmTriggerParam) || "";
      const idrDelayReason =
        searchParams.get(COMPLAINT_CONFIG.idrDelayReasonParam) || "";

      const complaintLetterType = findMatchingLetterTypeItem(items, letterCode);

      const complaintResult = resolveComplaintTemplate(
        complaintLetterType,
        items,
        modularContent,
        taskSubcategoryCode,
        upmTrigger,
        idrDelayReason
      );

      if (!complaintResult.template) {
        return NextResponse.json(
          {
            error: complaintResult.error || "Unable to resolve COMPLAINT template.",
          },
          { status: complaintResult.status || 404 }
        );
      }

      const content = extractContent(complaintResult.template, items, modularContent);
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
      resolvedTemplate = resolveTemplateDirectlyByCode(items, modularContent, letterCode);
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

    const content = extractContent(resolvedTemplate, items, modularContent);

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
