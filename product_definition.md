# Product Definition: `smiles` Frank Energie Node-RED Library

This document outlines the product definition, architecture, and node specifications for the `smiles` Frank Energie Node-RED library. The library is modeled after the Python library `HiDiHo01/python-frank-energie` and provides integrations with the Frank Energie GraphQL API.

---

## 1. Namespace & Naming Conventions

To ensure clean organization and avoid conflicts, all nodes in this library use the namespace **`smiles`**:
* **NPM Package Name**: `@smiles/node-red-frank-energie`
* **Node Palette Category**: `smiles` (nodes will be grouped under this category in the Node-RED editor)
* **Node Types (Prefix)**: `smiles-frank-energie-*`

---

## 2. Configuration Node (`smiles-frank-energie-config`)

A central configuration node that holds authentication credentials and manages the session lifecycle.

### Configuration Items (Credentials)
* `username` (text): The Frank Energie account email.
* `password` (password): The account password.
* *Note: Credentials are stored using Node-RED's secure credential mechanism (`credentials`), ensuring they are not saved in plain text in flow export files.*

### Behavior & Authentication Lifecycle
1. **Initial Login**: Exchanges `username` and `password` for an `authToken` and `refreshToken` via the GraphQL `Login` mutation on start or first query.
2. **Token Storage**: Maintains the token state in-memory inside the configuration node instance.
3. **Automatic Renewal**: Checks JWT expiration (decoded client-side or tracked by expiration timestamp) and automatically requests a new `authToken` using the `refreshToken` via the `RenewToken` mutation when the token is near expiration (within 5 minutes) or when a query fails with a `user-error:auth-not-authorised` / `user-error:auth-required` error.
4. **Retry Logic**: Automatically attempts to re-authenticate with the credentials if token renewal fails.

---

## 3. Functional Nodes

We propose three primary functional nodes to interact with Frank Energie data. Each node will reference the configuration node for authorization.

### A. Prices Node (`smiles-frank-energie-prices`)
Retrieves dynamic electricity and gas prices.
* **Inputs**:
  * `msg.payload.date` (optional, format: `YYYY-MM-DD`): Target date. Defaults to today.
  * `msg.payload.resolution` (optional): Resolution of price data (`PT15M`, `PT60M`). Defaults to `PT60M` (hourly).
  * `msg.payload.useCustomerPrices` (optional, boolean): If true and configured with credentials, retrieves personalized prices (`customerMarketPrices`) including markups and tax, rather than public market prices.
* **Outputs**:
  * `msg.payload`: A structured object containing arrays of electricity and gas prices with `from`, `till`, `marketPrice`, `marketPriceTax`, `sourcingMarkupPrice`, `energyTaxPrice`, and `allInPrice`.

### B. Consumption & Costs Node (`smiles-frank-energie-consumption`)
Fetches historical smart meter readings, consumption, and costs.
* **Inputs**:
  * `msg.payload.action` (required): The action to perform. One of:
    * `actualAndExpectedMeterReadings`: Fetch meter readings.
    * `periodUsageAndCosts`: Fetch usage and costs for a given period.
    * `monthSummary`: Fetch current month cost estimation and completeness.
    * `monthInsights`: Fetch detailed cost breakdowns and differences.
  * `msg.payload.siteReference` (optional): Site identifier. If not provided, the node will auto-fetch the active site from the user's account details.
  * `msg.payload.date` (optional): Format `YYYY-MM-DD` or `YYYY-MM` depending on action. Defaults to today or current month.
* **Outputs**:
  * `msg.payload`: Structured data matching the requested endpoint (e.g. usage totals, expected usage vs actual usage).

### C. Smart Controls Node (`smiles-frank-energie-smart-controls`)
Monitors and updates settings for smart assets (Batteries, HVAC, Electric Vehicles).
* **Inputs**:
  * `msg.payload.action` (required): The action to perform. One of:
    * `getSmartBatteries`: Get connected smart batteries and summary.
    * `updateSmartBatterySettings`: Update charging/trading modes.
    * `getEnodeVehicles`: Get EV state and charger info.
    * `updateVehicleChargeSettings`: Set deadlines and smart charging status.
    * `getSmartHvacStatus`: Get smart HVAC state.
    * `updateSmartHvacSettings`: Set bounds or modes.
  * `msg.payload.deviceId` or `msg.payload.id` (required for update actions): Target device identifier.
  * `msg.payload.settings` or `msg.payload.input` (required for update actions): Key-value object with settings to apply.
* **Outputs**:
  * `msg.payload`: Status of the operation or query results.

---

## 4. Technical Architecture

* **Backend Environment**: Node.js (supported Node-RED versions 2.x and 3.x+).
* **GraphQL Endpoint**: `https://frank-graphql-prod.graphcdn.app/`
* **Request Headers**: Custom headers spoofing the mobile app to prevent API rejection:
  ```json
  {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-graphql-client-version": "4.13.3",
    "x-graphql-client-name": "frank-app",
    "x-graphql-client-os": "ios/26.0.1",
    "skip-graphcdn": "1"
  }
  ```
* **Dependency Minimization**: Uses standard Node-RED HTTP request or clean lightweight HTTP libraries (like `axios`) to handle communication.

---

## 5. Next Steps

1. Review and refine this product definition.
2. Develop the Node.js API client module (re-usable library within the nodes).
3. Create the Node-RED configuration node and credentials markup.
4. Implement the functional nodes (`prices`, `consumption`, `smart-controls`).
5. Document installation, setup, and example flows.
