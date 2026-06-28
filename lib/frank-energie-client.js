const axios = require('axios');

class FrankEnergieClient {
    constructor({ authToken = null, refreshToken = null } = {}) {
        this.dataUrl = "https://frank-graphql-prod.graphcdn.app/";
        this.authToken = authToken;
        this.refreshToken = refreshToken;
        this.tokenExpiresAt = null;
        this.refreshTokenExpiresAt = null;

        if (authToken) {
            this._decodeTokens(authToken, refreshToken);
        }
    }

    _decodeTokens(authToken, refreshToken) {
        if (authToken) {
            this.authToken = authToken;
            this.tokenExpiresAt = this._extractExpiry(authToken);
        }
        if (refreshToken) {
            this.refreshToken = refreshToken;
            this.refreshTokenExpiresAt = this._extractExpiry(refreshToken);
        }
    }

    _extractExpiry(token) {
        try {
            const parts = token.split('.');
            if (parts.length < 3) return null;
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            if (payload && payload.exp) {
                return new Date(payload.exp * 1000);
            }
        } catch (e) {
            // Ignore error and return null
        }
        return null;
    }

    isTokenExpired() {
        if (!this.authToken) return true;
        if (!this.tokenExpiresAt) {
            // If token is not a valid JWT (e.g. mock/dummy), assume valid
            return this.authToken.split('.').length < 3;
        }
        // Renew token if it expires in less than 5 minutes
        const margin = 5 * 60 * 1000;
        return Date.now() >= (this.tokenExpiresAt.getTime() - margin);
    }

    async request(query, operationName, variables = {}, extraHeaders = {}) {
        // Automatically renew token if authenticated and expired
        if (operationName !== "RenewToken" && this.refreshToken && this.isTokenExpired()) {
            await this.renewToken();
        }

        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-graphql-client-version": "4.13.3",
            "x-graphql-client-name": "frank-app",
            "x-graphql-client-os": "ios/26.0.1",
            "skip-graphcdn": "1",
            ...extraHeaders
        };

        if (this.authToken && operationName !== "RenewToken") {
            headers["Authorization"] = `Bearer ${this.authToken}`;
        }

        const payload = {
            query,
            operationName,
            variables
        };

        try {
            const response = await axios.post(this.dataUrl, payload, { headers, timeout: 30000 });
            
            const responseData = response.data;
            if (responseData.errors && responseData.errors.length > 0) {
                const errMsg = responseData.errors[0].message;
                // Handle token expiration/authorization errors
                if (errMsg === "user-error:auth-not-authorised" || errMsg === "user-error:auth-required") {
                    throw new Error("Authentication required: " + errMsg);
                }
                throw new Error(errMsg);
            }
            return responseData;
        } catch (error) {
            if (error.response && error.response.status === 401) {
                throw new Error("Authentication required (401)");
            }
            throw error;
        }
    }

    async login(email, password) {
        if (!email || !password) {
            throw new Error("Username and password must be provided.");
        }

        const query = `
            mutation Login($email: String!, $password: String!) {
                login(email: $email, password: $password) {
                    authToken
                    refreshToken
                    __typename
                }
                version
                __typename
            }
        `;

        const result = await this.request(query, "Login", { email, password });
        const loginData = result.data && result.data.login;
        if (!loginData) {
            throw new Error("Login failed. No token data received.");
        }

        this._decodeTokens(loginData.authToken, loginData.refreshToken);
        return {
            authToken: this.authToken,
            refreshToken: this.refreshToken,
            tokenExpiresAt: this.tokenExpiresAt
        };
    }

    async renewToken() {
        if (!this.refreshToken) {
            throw new Error("Authentication is required. No refresh token available.");
        }

        const query = `
            mutation RenewToken($authToken: String!, $refreshToken: String!) {
                renewToken(authToken: $authToken, refreshToken: $refreshToken) {
                    authToken
                    refreshToken
                }
            }
        `;

        const result = await this.request(query, "RenewToken", {
            authToken: this.authToken || "",
            refreshToken: this.refreshToken
        });

        const renewData = result.data && result.data.renewToken;
        if (!renewData) {
            throw new Error("Token renewal failed. No token data received.");
        }

        this._decodeTokens(renewData.authToken, renewData.refreshToken);
        return {
            authToken: this.authToken,
            refreshToken: this.refreshToken,
            tokenExpiresAt: this.tokenExpiresAt
        };
    }

    async getMarketPrices(dateStr, resolution = "PT60M") {
        if (!dateStr) {
            dateStr = new Date().toISOString().split('T')[0];
        }

        const query = `
            query MarketPrices($date: String!, $resolution: PriceResolution!) {
                marketPrices(date: $date, resolution: $resolution) {
                    averageElectricityPrices {
                        averageMarketPrice
                        averageMarketPricePlus
                        averageAllInPrice
                        perUnit
                        isWeighted
                    }
                    electricityPrices {
                        from
                        till
                        resolution
                        marketPrice
                        marketPriceTax
                        sourcingMarkupPrice
                        energyTaxPrice
                        marketPricePlus
                        allInPrice
                        perUnit
                    }
                    gasPrices {
                        from
                        till
                        resolution
                        marketPrice
                        marketPriceTax
                        sourcingMarkupPrice
                        energyTaxPrice
                        marketPricePlus
                        allInPrice
                        perUnit
                    }
                }
            }
        `;

        const result = await this.request(query, "MarketPrices", { date: dateStr, resolution });
        return result.data && result.data.marketPrices;
    }

    async getCustomerPrices(siteReference, userCountry = "NL", dateStr, resolution = "PT15M") {
        if (!this.authToken) {
            throw new Error("Authentication is required for customer-specific prices.");
        }
        if (!siteReference) {
            throw new Error("A valid siteReference must be provided.");
        }
        if (!dateStr) {
            dateStr = new Date().toISOString().split('T')[0];
        }

        const query = `
            query MarketPrices($date: String!, $siteReference: String!) {
                customerMarketPrices(date: $date, siteReference: $siteReference) {
                    id
                    averageElectricityPrices {
                        averageMarketPrice
                        averageMarketPricePlus
                        averageAllInPrice
                        perUnit
                        isWeighted
                    }
                    electricityPrices {
                        id
                        date
                        from
                        till
                        resolution
                        marketPrice
                        marketPricePlus
                        marketPriceTax
                        sourcingMarkupPrice: consumptionSourcingMarkupPrice
                        energyTaxPrice: energyTax
                        allInPrice
                    }
                    gasPrices {
                        id
                        date
                        from
                        till
                        resolution
                        marketPrice
                        marketPricePlus
                        marketPriceTax
                        sourcingMarkupPrice: consumptionSourcingMarkupPrice
                        energyTaxPrice: energyTax
                        perUnit
                        allInPriceComponents {
                            name
                            value
                        }
                        marketPricePlusComponents {
                            name
                            value
                        }
                    }
                }
            }
        `;

        const extraHeaders = { "x-country": userCountry };
        const result = await this.request(query, "MarketPrices", { date: dateStr, siteReference }, extraHeaders);
        return result.data && result.data.customerMarketPrices;
    }

    async getMe(siteReference) {
        if (!this.authToken) {
            throw new Error("Authentication is required.");
        }
        if (!siteReference) {
            throw new Error("A valid siteReference must be provided.");
        }

        const query = `
            query Me($siteReference: String!) {
                me {
                    id
                    email
                    countryCode
                    connections(siteReference: $siteReference) {
                        id
                        connectionId
                        EAN
                        segment
                        status
                        contractStatus
                    }
                }
            }
        `;

        const result = await this.request(query, "Me", { siteReference });
        return result.data && result.data.me;
    }

    async getUserSites() {
        if (!this.authToken) {
            throw new Error("Authentication is required.");
        }

        const query = `
            query UserSites {
                userSites {
                    address {
                        addressFormatted
                    }
                    addressHasMultipleSites
                    deliveryEndDate
                    deliveryStartDate
                    firstMeterReadingDate
                    lastMeterReadingDate
                    propositionType
                    reference
                    segments
                    status
                }
            }
        `;

        const result = await this.request(query, "UserSites");
        return result.data && result.data.userSites;
    }

    // --- Consumption & Costs ---

    async getMeterReadings(siteReference) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!siteReference) throw new Error("siteReference must be provided.");

        const query = `
            query ActualAndExpectedMeterReadings($siteReference: String!) {
                completenessPercentage
                actualMeterReadings {
                    date
                    consumptionKwh
                }
                expectedMeterReadings {
                    date
                    consumptionKwh
                }
            }
        `;

        const result = await this.request(query, "ActualAndExpectedMeterReadings", { siteReference });
        return result.data;
    }

    async getMonthSummary(siteReference) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!siteReference) throw new Error("siteReference must be provided.");

        const query = `
            query MonthSummary($siteReference: String!) {
                monthSummary(siteReference: $siteReference) {
                    _id
                    actualCostsUntilLastMeterReadingDate
                    expectedCostsUntilLastMeterReadingDate
                    expectedCosts
                    lastMeterReadingDate
                    meterReadingDayCompleteness
                    gasExcluded
                }
            }
        `;

        const result = await this.request(query, "MonthSummary", { siteReference });
        return result.data && result.data.monthSummary;
    }

    async getMonthInsights(siteReference, dateStr) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!siteReference) throw new Error("siteReference must be provided.");
        if (!dateStr) throw new Error("date (YYYY-MM) must be provided.");

        const query = `
            query MonthInsights($date: String!, $siteReference: String!) {
                monthInsights(date: $date, siteReference: $siteReference) {
                    _id
                    expectedCosts
                    expectedCostsGas
                    expectedCostsFixed
                    expectedCostsElectricity
                    expectedCostsFeedIn
                    expectedCostsUntilLastMeterReading
                    actualCostsUntilLastMeterReading
                    lastMeterReadingDate
                    invoiceId
                    gasDifference {
                        actualUsage
                        actualAverageUnitPrice
                        actualCosts
                        expectedUsage
                        expectedAverageUnitPrice
                        expectedCosts
                        unit
                    }
                    electricityDifference {
                        actualUsage
                        actualAverageUnitPrice
                        actualCosts
                        expectedUsage
                        expectedAverageUnitPrice
                        expectedCosts
                        unit
                    }
                    feedInDifference {
                        actualUsage
                        actualAverageUnitPrice
                        actualCosts
                        expectedUsage
                        expectedAverageUnitPrice
                        expectedCosts
                        unit
                    }
                    meterReadingDayCompleteness
                    gasExcluded
                }
            }
        `;

        const result = await this.request(query, "MonthInsights", { siteReference, date: dateStr });
        return result.data && result.data.monthInsights;
    }

    async getPeriodUsageAndCosts(siteReference, startDateStr) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!siteReference) throw new Error("siteReference must be provided.");
        if (!startDateStr) throw new Error("date (YYYY-MM-DD or YYYY-MM) must be provided.");

        const query = `
            query PeriodUsageAndCosts($date: String!, $siteReference: String!) {
                periodUsageAndCosts(date: $date, siteReference: $siteReference) {
                    _id
                    gas {
                        usageTotal
                        costsTotal
                        unit
                        items {
                            date
                            from
                            till
                            usage
                            costs
                            unit
                        }
                    }
                    electricity {
                        usageTotal
                        costsTotal
                        unit
                        items {
                            date
                            from
                            till
                            usage
                            costs
                            unit
                        }
                    }
                    feedIn {
                        usageTotal
                        costsTotal
                        unit
                        items {
                            date
                            from
                            till
                            usage
                            costs
                            unit
                        }
                    }
                }
            }
        `;

        const result = await this.request(query, "PeriodUsageAndCosts", { siteReference, date: startDateStr });
        return result.data && result.data.periodUsageAndCosts;
    }

    // --- Smart Controls & Assets ---

    async getSmartBatteries() {
        if (!this.authToken) throw new Error("Authentication is required.");

        const query = `
            query SmartBatteries {
                smartBatteries {
                    brand
                    capacity
                    createdAt
                    externalReference
                    id
                    maxChargePower
                    maxDischargePower
                    provider
                    updatedAt
                }
            }
        `;

        const result = await this.request(query, "SmartBatteries");
        return result.data && result.data.smartBatteries;
    }

    async getSmartBatteryDetails(deviceId) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!deviceId) throw new Error("deviceId must be provided.");

        const query = `
            query SmartBattery($deviceId: String!) {
                smartBattery(deviceId: $deviceId) {
                    brand
                    capacity
                    id
                    settings {
                        batteryMode
                        imbalanceTradingStrategy
                        selfConsumptionTradingAllowed
                        selfConsumptionTradingThresholdPrice
                    }
                }
                smartBatterySummary(deviceId: $deviceId) {
                    lastKnownStateOfCharge
                    lastKnownStatus
                    lastUpdate
                    totalResult
                }
            }
        `;

        const result = await this.request(query, "SmartBattery", { deviceId });
        return result.data;
    }

    async updateSmartBatterySettings(deviceId, settings) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!deviceId) throw new Error("deviceId must be provided.");
        if (!settings) throw new Error("settings object must be provided.");

        const query = `
            mutation SmartBatteryUpdateSettings($deviceId: String!, $settings: SmartBatteryUpdateSettingsInput!) {
                smartBatteryUpdateSettings(deviceId: $deviceId, settings: $settings) {
                    batteryMode
                    createdAt
                    imbalanceTradingStrategy
                    selfConsumptionTradingThresholdPrice
                    updatedAt
                }
            }
        `;

        const result = await this.request(query, "SmartBatteryUpdateSettings", { deviceId, settings });
        return result.data && result.data.smartBatteryUpdateSettings;
    }

    async getSmartHvacStatus() {
        if (!this.authToken) throw new Error("Authentication is required.");

        const query = `
            query SmartHvacStatus {
                me {
                    smartHvac {
                        isActivated
                        isAvailableInCountry
                        userCreatedAt
                        userId
                    }
                }
            }
        `;

        const result = await this.request(query, "SmartHvacStatus");
        return result.data && result.data.me && result.data.me.smartHvac;
    }

    async updateSmartHvacSettings(deviceId, settings) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!deviceId) throw new Error("deviceId must be provided.");
        if (!settings) throw new Error("settings object must be provided.");

        const query = `
            mutation SmartHvacUpdateSettings($deviceId: String!, $settings: SmartHvacUpdateSettingsInput!) {
                smartHvacUpdateSettings(deviceId: $deviceId, settings: $settings) {
                    createdAt
                    mode
                    temperatureLowerBound
                    temperatureUpperBound
                    updatedAt
                }
            }
        `;

        const result = await this.request(query, "SmartHvacUpdateSettings", { deviceId, settings });
        return result.data && result.data.smartHvacUpdateSettings;
    }

    async getEnodeVehicles() {
        if (!this.authToken) throw new Error("Authentication is required.");

        const query = `
            query EnodeVehicles {
                enodeVehicles {
                    canSmartCharge
                    chargeSettings {
                        calculatedDeadline
                        deadline
                        hourFriday
                        hourMonday
                        hourSaturday
                        hourSunday
                        hourThursday
                        hourTuesday
                        hourWednesday
                        id
                        isSmartChargingEnabled
                        isSolarChargingEnabled
                        maxChargeLimit
                        minChargeLimit
                    }
                    chargeState {
                        batteryCapacity
                        batteryLevel
                        chargeLimit
                        chargeRate
                        chargeTimeRemaining
                        isCharging
                        isFullyCharged
                        isPluggedIn
                        lastUpdated
                        powerDeliveryState
                        range
                    }
                    id
                    information {
                        brand
                        model
                        vin
                        year
                    }
                    interventions {
                        description
                        title
                    }
                    isReachable
                    lastSeen
                }
            }
        `;

        const result = await this.request(query, "EnodeVehicles");
        return result.data && result.data.enodeVehicles;
    }

    async getEnodeChargers(siteReference) {
        if (!this.authToken) throw new Error("Authentication is required.");

        const query = `
            query EnodeChargers {
                enodeChargers {
                    canSmartCharge
                    chargeSettings {
                        calculatedDeadline
                        capacity
                        deadline
                        hourFriday
                        hourMonday
                        hourSaturday
                        hourSunday
                        hourThursday
                        hourTuesday
                        hourWednesday
                        id
                        initialCharge
                        initialChargeTimestamp
                        isSmartChargingEnabled
                        isSolarChargingEnabled
                        maxChargeLimit
                        minChargeLimit
                    }
                    chargeState {
                        batteryCapacity
                        batteryLevel
                        chargeLimit
                        chargeRate
                        chargeTimeRemaining
                        isCharging
                        isFullyCharged
                        isPluggedIn
                        lastUpdated
                        powerDeliveryState
                        range
                    }
                    id
                    information {
                        brand
                        model
                        year
                    }
                    interventions {
                        description
                        title
                    }
                    isReachable
                    lastSeen
                }
            }
        `;

        const result = await this.request(query, "EnodeChargers", { siteReference });
        return result.data && result.data.enodeChargers;
    }

    async updateVehicleChargeSettings(input) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!input || !input.id) throw new Error("input object with 'id' must be provided.");

        // Map client-side 'id' to vehicleId API expected input
        const apiInput = { ...input };
        apiInput.vehicleId = apiInput.id;
        delete apiInput.id;

        const query = `
            mutation EnodeUpdateVehicleChargeSettings($input: EnodeUpdateVehicleChargeSettingsInputType!) {
                enodeUpdateVehicleChargeSettings(input: $input)
            }
        `;

        const result = await this.request(query, "EnodeUpdateVehicleChargeSettings", { input: apiInput });
        return result.data && result.data.enodeUpdateVehicleChargeSettings;
    }

    async updateChargerChargeSettings(input) {
        if (!this.authToken) throw new Error("Authentication is required.");
        if (!input || !input.id) throw new Error("input object with 'id' must be provided.");

        // Map client-side 'id' to chargerId API expected input
        const apiInput = { ...input };
        apiInput.chargerId = apiInput.id;
        delete apiInput.id;

        const query = `
            mutation EnodeUpdateChargerChargeSettings($input: EnodeUpdateChargerChargeSettingsInputType!) {
                enodeUpdateChargerChargeSettings(input: $input)
            }
        `;

        const result = await this.request(query, "EnodeUpdateChargerChargeSettings", { input: apiInput });
        return result.data && result.data.enodeUpdateChargerChargeSettings;
    }
}

module.exports = FrankEnergieClient;
