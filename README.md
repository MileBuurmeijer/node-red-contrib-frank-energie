# @smilesb/node-red-frank-energie

A Node-RED node library under the `smiles` namespace that queries the **Frank Energie** GraphQL API. It is modeled after the Python library `HiDiHo01/python-frank-energie`.

---

## Features

* **Config Node (`smiles-frank-energie-config`)**: Securely handles username and password authentication, fetches active customer sites, keeps dynamic tokens in memory, and automatically handles token renewal via refresh tokens.
* **Prices Node (`smiles-frank-energie-prices`)**: Fetches dynamic gas and electricity market prices (both public prices and customer-specific prices including tax/markups).
* **Consumption Node (`smiles-frank-energie-consumption`)**: Retrieves historical smart meter readings, monthly cost summaries, and detail breakdowns.
* **Smart Controls Node (`smiles-frank-energie-smart-controls`)**: Monitors and updates configurations for connected smart assets (smart batteries trading mode, HVAC temperatures, and EV charging options).

---

## Installation

Run the following command in your Node-RED user directory (typically `~/.node-red`):

```bash
npm install @smilesb/node-red-frank-energie
```

---

## Configuration & Usage

### 1. Configuration Node (`smiles-frank-energie-config`)

Set up a configuration node with your Frank Energie credentials:
* **Email**: The email address of your Frank Energie account.
* **Password**: The password of your Frank Energie account.

*Note: Credentials are stored securely using Node-RED's built-in credentials management and are not serialized in plain text inside flow exports.*

### 2. Prices Node (`smiles-frank-energie-prices`)

Retrieves hourly or quarter-hourly energy prices.

#### Inputs (via `msg.payload`)
* `date` (string, optional): The target date formatted as `YYYY-MM-DD`. Defaults to today.
* `resolution` (string, optional): Price resolution, either `PT60M` (hourly) or `PT15M` (15-minute). Defaults to `PT60M`.
* `useCustomerPrices` (boolean, optional): Set to `true` to fetch customer-specific rates (including markups and tax). Set to `false` to query public market prices.
* `siteReference` (string, optional): Specific site reference (e.g. `S-XXXXXXX`). If omitted, it will automatically resolve to the first site on the account.
* `userCountry` (string, optional): Country code (e.g. `NL`, `BE`). Defaults to `NL` (or auto-resolved if blank).

#### Outputs
Outputs a `msg` where `msg.payload` contains:
* `averageElectricityPrices`: Average electricity price parameters for the day.
* `electricityPrices`: Array of electricity price periods containing `from`, `till`, `marketPrice`, `marketPriceTax`, `sourcingMarkupPrice`, `energyTaxPrice`, `allInPrice`, etc.
* `gasPrices`: Array of gas price periods.

---

### 3. Consumption Node (`smiles-frank-energie-consumption`)

Fetches smart meter readings and invoice period costs.

#### Inputs (via `msg.payload`)
* `action` (string, required): The action to perform. One of:
  * `actualAndExpectedMeterReadings`: Daily smart meter usage.
  * `monthSummary`: Month cost summary.
  * `monthInsights`: Invoice differences and details.
  * `periodUsageAndCosts`: Total and hourly usage breakdowns for gas/electricity/feed-in.
* `siteReference` (string, optional): Auto-resolves if left blank.
* `date` (string, optional): Target period string. Format `YYYY-MM` for `monthInsights` or `YYYY-MM-DD` for `periodUsageAndCosts`.

#### Outputs
Outputs `msg.payload` containing the requested dataset from Frank Energie.

---

### 4. Smart Controls Node (`smiles-frank-energie-smart-controls`)

Retrieves status and updates settings of smart batteries, EV charging, and smart HVAC assets.

#### Inputs (via `msg.payload`)
* `action` (string, required): The action to perform. One of:
  * **Batteries**: `getSmartBatteries`, `getSmartBatteryDetails`, `updateSmartBatterySettings`.
  * **EV Vehicles/Chargers**: `getEnodeVehicles`, `getEnodeChargers`, `updateVehicleChargeSettings`, `updateChargerChargeSettings`.
  * **HVAC**: `getSmartHvacStatus`, `updateSmartHvacSettings`.
* `deviceId` (string, optional): Target device/settings ID to execute the action on (required for details and updates).
* `settings` (object, optional): Object with key-value settings changes to apply (e.g. `{ "batteryMode": "SMART" }` or `{ "isSmartChargingEnabled": true }`).

#### Outputs
Outputs `msg.payload` with the query result or status of settings updates.

---

## Example Flows

Here is an example flow to retrieve public market prices:

```json
[
    {
        "id": "inject_prices",
        "type": "inject",
        "z": "flow_id",
        "name": "Trigger Price Fetch",
        "props": [
            {
                "p": "payload"
            }
        ],
        "repeat": "",
        "crontab": "",
        "once": false,
        "onceDelay": 0.1,
        "topic": "",
        "payload": "{}",
        "payloadType": "json",
        "x": 150,
        "y": 120,
        "wires": [
            [
                "prices_node"
            ]
        ]
    },
    {
        "id": "prices_node",
        "type": "smiles-frank-energie-prices",
        "z": "flow_id",
        "name": "",
        "config": "",
        "date": "",
        "resolution": "PT60M",
        "useCustomerPrices": false,
        "siteReference": "",
        "userCountry": "NL",
        "x": 380,
        "y": 120,
        "wires": [
            [
                "debug_node"
            ]
        ]
    },
    {
        "id": "debug_node",
        "type": "debug",
        "z": "flow_id",
        "name": "Display Prices",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "payload",
        "targetType": "msg",
        "statusVal": "",
        "statusType": "auto",
        "x": 610,
        "y": 120,
        "wires": []
    }
]
```

---

## License

MIT
