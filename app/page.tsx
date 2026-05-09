"use client";

import { Fragment, useState } from "react";

type XmlValue = string | XmlObject | XmlValue[];

type XmlObject = {
  [key: string]: XmlValue;
};

export default function Home() {
  const [xmlUrl, setXmlUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [records, setRecords] = useState<XmlObject[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  // letterCodeFilter is set by the dropdown; empty string means "show all".
  const [letterCodeFilter, setLetterCodeFilter] = useState("");

  // Convert an XML element recursively into a plain JavaScript object.
  const elementToObject = (element: Element): XmlObject => {
    const childElements = Array.from(element.children);

    if (childElements.length === 0) {
      return { value: element.textContent?.trim() ?? "" };
    }

    const output: XmlObject = {};

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

  // Load XML from URL, parse it with DOMParser, then store repeating nodes as records.
  const handleLoadXml = async () => {
    const trimmedUrl = xmlUrl.trim();

    if (!trimmedUrl) {
      setErrorMessage("Please enter an XML URL.");
      setRecords([]);
      return;
    }

    if (trimmedUrl.endsWith("/")) {
      setErrorMessage(
        "Please provide the full XML blob URL including the file name, not just the container path."
      );
      setRecords([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setRecords([]);
    setCurrentIndex(0);
    setLetterCodeFilter("");

    try {
      // Fetch through a same-origin API route so browser CORS rules do not block Azure requests.
      const response = await fetch(
        `/api/load-xml?url=${encodeURIComponent(trimmedUrl)}`
      );

      if (!response.ok) {
        throw new Error(`Unable to load XML. Status: ${response.status}.`);
      }

      const xmlText = await response.text();
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
        const code = obj["Letter_Code_"];
        if (!code || (typeof code === "string" && code.trim() === "")) {
          const letterData = obj["Letter_Data"];
          if (
            letterData !== null &&
            typeof letterData === "object" &&
            !Array.isArray(letterData)
          ) {
            const fallbackKey = Object.keys(letterData as XmlObject)[0];
            if (fallbackKey) {
              obj["Letter_Code_"] = fallbackKey;
            }
          }
        }

        return obj;
      });

      setRecords(parsedRecords);
    } catch (error) {
      const message =
        error instanceof TypeError
          ? "Failed to load XML through the API proxy. Confirm the URL is reachable and points to a valid XML blob."
          : error instanceof Error
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

  return (
    <main
      style={{
        maxWidth: "860px",
        margin: "0 auto",
        padding: "2rem 1rem",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ marginBottom: "1rem", fontSize: "1.6rem" }}>Azure XML Loader</h1>

      <section
        style={{
          display: "grid",
          gap: "0.75rem",
          padding: "1rem",
          border: "1px solid #d6d6d6",
          borderRadius: "8px",
          backgroundColor: "#fafafa",
        }}
      >
        <label htmlFor="xml-url">XML Blob URL</label>
        <input
          id="xml-url"
          type="text"
          value={xmlUrl}
          onChange={(event) => setXmlUrl(event.target.value)}
          placeholder="https://pspds.blob.core.windows.net/medibankassets/BP111PROD2_PrintBatch_20260320_101009.xml"
          style={{
            padding: "0.5rem",
            border: "1px solid #b9b9b9",
            borderRadius: "6px",
            backgroundColor: "#fff",
          }}
        />

        <small style={{ color: "#555" }}>
          Paste a direct XML blob URL ending with .xml — not a container path. Make sure the blob
          exists and is publicly readable. Upload or confirm the file in Azure Storage Explorer first.
        </small>

        <button
          type="button"
          onClick={handleLoadXml}
          disabled={isLoading}
          style={{
            padding: "0.65rem 1rem",
            border: "none",
            borderRadius: "6px",
            backgroundColor: isLoading ? "#888" : "#1f4ab8",
            color: "#fff",
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "Loading..." : "Load XML"}
        </button>
      </section>

      {errorMessage && (
        <p style={{ marginTop: "1rem", color: "#b00020" }}>Error: {errorMessage}</p>
      )}

      {records.length > 0 && (
        <p style={{ marginTop: "1rem", color: "#333", fontSize: "0.9rem" }}>
          Loaded <strong>{records.length}</strong> record{records.length !== 1 ? "s" : ""}.
          {letterCodes.length > 0
            ? ` Letter codes found: ${letterCodes.join(", ")}.`
            : " No Letter_Code_ values detected in this XML."}
        </p>
      )}

      {records.length > 0 && (
        <section
          style={{
            marginTop: "0.5rem",
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
            marginTop: "0.75rem",
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
        <p style={{ marginTop: "1rem", color: "#555" }}>
          No records match the selected letter type.
        </p>
      )}

      {filteredRecord !== null && (
        <section style={{ marginTop: "1rem" }}>
          <h2 style={{ marginBottom: "0.75rem", fontSize: "1.1rem" }}>
            Record {currentIndex + 1}{" "}
            <span style={{ color: "#555", fontWeight: 400, fontSize: "0.9rem" }}>
              — {String(filteredRecord["Letter_Code_"] ?? "Unknown letter type")}
            </span>
          </h2>

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
              <h3 style={{ marginBottom: "0.4rem", fontSize: "0.95rem", color: "#333" }}>
                Letter Data
              </h3>
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
    </main>
  );
}
