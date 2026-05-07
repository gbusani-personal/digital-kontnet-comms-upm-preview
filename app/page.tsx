"use client";

import { useState } from "react";

type Environment = "UAT" | "PREPROD" | "PROD";

const API_BASE_BY_ENV: Record<Environment, string> = {
  UAT: "https://uat.api.example.com",
  PREPROD: "https://preprod.api.example.com",
  PROD: "https://api.example.com",
};

// Temporary in-memory policy data used for local matching and rendering.
const TEMP_POLICY_MEMORY = {
  policyNumber: "0012259",
  fullPolicyNumber: "PI00122592",
  onlineNumber: "PI1211-196784",
  breed: "Cavalier King Charles Spaniel",
  animalName: "Folie",
  startDate: "13 November 2024",
  endDate: "13 November 2025",
  partnerNumber: "PI",
  planDescription: "Accident & GVE",
  levelOfCover: 80,
  benifitPercentage: 80,
  excess: 100,
  excessType: "Per Condition Excess",
  animalGender: 1,
  species: "Canine",
  animalDateOfBirth: "10 September 2012",
  annualPremium: 4255.68,
  instalment: 354.64,
  paymentFrequency: "MONTHLY",
  underwriter: "H",
  planNo: 985,
  insuredState: "WA",
  productGeneration: "GLM2",
  policyName: "Major Medical with Routine Care 80%",
  planType: "Accident & GVE",
  nextPaymentDate: "14 February 2025",
  nextCollectionAmount: 0,
  policyHolder: {
    title: "Mrs",
    firstName: "Twyla",
    lastName: "Blakebrough",
    dateOfBirth: "10 September 2012",
    street: "6 Schiller Park",
    suburb: "ROCKINGHAM",
    postCode: "6168",
    email: "tblakebrough5kgr@yopmail.com",
    phoneHome: "7448616903",
    phoneMobile: "0414554585",
  },
  bankingInfo: {
    paymentMethod: "Credit Card",
    bsbNumber: "",
    bank: "",
    accountNumber: "",
    accountHolderName: "",
    cardType: "VISA",
    cardOwnerName: "Twyla Blakebroug",
    cardNumber: "XXXXXXXXX731",
    cardExpiryDate: "0828",
  },
  reimbursementInfo: {
    paymentMethod: "Credit Card",
    bsbNumber: "",
    bank: "BankWest",
    accountNumber: "",
    accountHolderName: "",
  },
  policyCover: {
    alternativeTherapy: false,
    alternativeTherapyLimit: null,
    annualConditionLimit: null,
    boosterCareLimit: null,
    consultationFee: null,
    cruciateLigamentBothLegs: 5000,
    cruciateLigamentPerLeg: null,
    dentalCareLimit: null,
    emergencyBoarding: 1200,
    hipJointSurgeryPerHip: null,
    paralysisTick: 3000,
    routineCareLimit: 145,
    dentalCare: false,
    boosterCare: false,
    routineCare: true,
    commencementWaitingDays: "0",
    illnessWaitingDays: "30",
    annualBenefitLimit: 30000,
    boosterCareName: null,
  },
};

export default function Home() {
  const [policyNumber, setPolicyNumber] = useState("");
  const [environment, setEnvironment] = useState<Environment>("UAT");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [responseData, setResponseData] = useState<unknown | null>(null);

  // Match the entered policy number against temporary in-memory data on CTA click.
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
      // Keep environment selection visible in the UI flow for future API wiring.
      void API_BASE_BY_ENV[environment];

      const policyMatches =
        trimmedPolicy === TEMP_POLICY_MEMORY.policyNumber ||
        trimmedPolicy === TEMP_POLICY_MEMORY.fullPolicyNumber;

      if (policyMatches) {
        setResponseData(TEMP_POLICY_MEMORY);
      } else {
        setErrorMessage(
          "No matching policy found in temporary memory. Try policyNumber or fullPolicyNumber."
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while reading temporary memory.";
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
