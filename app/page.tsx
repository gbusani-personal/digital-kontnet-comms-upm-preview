"use client";

import { useState } from "react";

type Environment = "UAT" | "PREPROD" | "PROD";

const API_BASE_BY_ENV: Record<Environment, string> = {
  UAT: "https://uat.api.example.com",
  PREPROD: "https://preprod.api.example.com",
  PROD: "https://api.example.com",
};

export default function Home() {
  const [policyNumber, setPolicyNumber] = useState("");
  const [environment, setEnvironment] = useState<Environment>("UAT");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [responseData, setResponseData] = useState<unknown | null>(null);

  // Build the endpoint from the selected environment and the entered policy number.
  const buildPolicyUrl = (selectedEnvironment: Environment, policy: string) => {
    const encodedPolicy = encodeURIComponent(policy.trim());
    return `${API_BASE_BY_ENV[selectedEnvironment]}/policy/${encodedPolicy}`;
  };

  // Fetch policy details and update loading, error, and response states.
  const handleFetchPolicy = async () => {
    const trimmedPolicy = policyNumber.trim();

    if (!trimmedPolicy) {
      setErrorMessage("Please enter a policy number.");
      setResponseData(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setResponseData(null);

    try {
      const endpoint = buildPolicyUrl(environment, trimmedPolicy);
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}.`);
      }

      const data: unknown = await response.json();
      setResponseData(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while fetching policy data.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main
      style={{
        maxWidth: "760px",
        margin: "0 auto",
        padding: "2rem 1rem",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ marginBottom: "1rem", fontSize: "1.6rem" }}>Policy Fetcher</h1>

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
        <label htmlFor="policy-number">Policy Number</label>
        <input
          id="policy-number"
          type="text"
          value={policyNumber}
          onChange={(event) => setPolicyNumber(event.target.value)}
          placeholder="Enter policy number"
          style={{
            padding: "0.5rem",
            border: "1px solid #b9b9b9",
            borderRadius: "6px",
            backgroundColor: "#fff",
          }}
        />

        <label htmlFor="environment">Environment</label>
        <select
          id="environment"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value as Environment)}
          style={{
            padding: "0.5rem",
            border: "1px solid #b9b9b9",
            borderRadius: "6px",
            backgroundColor: "#fff",
          }}
        >
          <option value="UAT">UAT</option>
          <option value="PREPROD">PREPROD</option>
          <option value="PROD">PROD</option>
        </select>

        <button
          type="button"
          onClick={handleFetchPolicy}
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
          {isLoading ? "Loading..." : "Fetch Policy"}
        </button>
      </section>

      {errorMessage && (
        <p style={{ marginTop: "1rem", color: "#b00020" }}>Error: {errorMessage}</p>
      )}

      {responseData !== null && (
        <section style={{ marginTop: "1rem" }}>
          <h2 style={{ marginBottom: "0.5rem", fontSize: "1.1rem" }}>API Response</h2>
          <pre
            style={{
              margin: 0,
              padding: "1rem",
              overflowX: "auto",
              borderRadius: "8px",
              border: "1px solid #d6d6d6",
              backgroundColor: "#f3f4f6",
            }}
          >
            {JSON.stringify(responseData, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}
