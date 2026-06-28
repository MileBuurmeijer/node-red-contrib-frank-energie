const FrankEnergieClient = require('./lib/frank-energie-client');

module.exports = function(RED) {
    // 1. Config Node
    function FrankEnergieConfigNode(config) {
        RED.nodes.createNode(this, config);
        
        // Load credentials securely
        this.username = this.credentials ? this.credentials.username : null;
        this.password = this.credentials ? this.credentials.password : null;
        
        // Cache the client instance to preserve tokens in memory
        this.client = new FrankEnergieClient();

        this.getClient = async () => {
            // If username and password are not set, return client unauthenticated (for public queries)
            if (!this.username || !this.password) {
                return this.client;
            }

            // Authenticate if we don't have a token or it's expired
            if (!this.client.authToken || this.client.isTokenExpired()) {
                try {
                    this.log("Authenticating with Frank Energie API...");
                    await this.client.login(this.username, this.password);
                    this.log("Successfully authenticated.");
                } catch (error) {
                    this.error("Frank Energie Auth Error: " + error.message);
                    throw error;
                }
            } else {
                // If token is about to expire, renew it in the background/preemptively
                if (this.client.isTokenExpired()) {
                    try {
                        this.log("Renewing Frank Energie token...");
                        await this.client.renewToken();
                    } catch (error) {
                        this.warn("Failed to renew token: " + error.message + ". Retrying full login...");
                        await this.client.login(this.username, this.password);
                    }
                }
            }
            return this.client;
        };
    }

    RED.nodes.registerType("smiles-frank-energie-config", FrankEnergieConfigNode, {
        credentials: {
            username: {type:"text"},
            password: {type:"password"}
        }
    });

    // 2. Prices Node
    function FrankEnergiePricesNode(config) {
        RED.nodes.createNode(this, config);
        this.configNode = RED.nodes.getNode(config.config);
        
        // Default properties from editor configuration
        this.resolution = config.resolution || "PT60M";
        this.useCustomerPrices = config.useCustomerPrices || false;
        this.siteReference = config.siteReference || "";
        this.userCountry = config.userCountry || "NL";

        this.on('input', async (msg, send, done) => {
            // Compatibility support for older Node-RED versions
            send = send || function() { this.send.apply(this, arguments); }.bind(this);
            done = done || function(err) { if (err) this.error(err, msg); }.bind(this);

            this.status({fill:"blue", shape:"dot", text:"fetching"});

            try {
                // Determine runtime values from payload or defaults
                const payload = msg.payload || {};
                const dateStr = payload.date || config.date || new Date().toISOString().split('T')[0];
                const resolution = payload.resolution || this.resolution;
                const useCustomerPrices = (payload.useCustomerPrices !== undefined) ? payload.useCustomerPrices : this.useCustomerPrices;
                
                let client;
                if (this.configNode) {
                    client = await this.configNode.getClient();
                } else {
                    // Create an unauthenticated client if no config is selected
                    client = new FrankEnergieClient();
                }

                let prices;
                if (useCustomerPrices) {
                    if (!this.configNode || !this.configNode.username) {
                        throw new Error("Configuration node with credentials is required for customer-specific prices.");
                    }

                    // Resolve siteReference automatically if empty
                    let siteRef = payload.siteReference || this.siteReference;
                    if (!siteRef) {
                        this.log("Resolving site reference automatically...");
                        const sites = await client.getUserSites();
                        if (sites && sites.length > 0) {
                            siteRef = sites[0].reference;
                            this.log("Auto-resolved site reference: " + siteRef);
                        } else {
                            throw new Error("No site reference found on the Frank Energie account.");
                        }
                    }

                    // Resolve country code automatically if empty
                    let country = payload.userCountry || this.userCountry;
                    if (!country) {
                        const meInfo = await client.getMe(siteRef);
                        country = (meInfo && meInfo.countryCode) ? meInfo.countryCode : "NL";
                    }

                    prices = await client.getCustomerPrices(siteRef, country, dateStr, resolution);
                } else {
                    prices = await client.getMarketPrices(dateStr, resolution);
                }

                msg.payload = prices;
                this.status({});
                send(msg);
                done();
            } catch (error) {
                this.status({fill:"red", shape:"ring", text: error.message || "error"});
                done(error);
            }
        });
    }

    RED.nodes.registerType("smiles-frank-energie-prices", FrankEnergiePricesNode);

    // 3. Consumption Node
    function FrankEnergieConsumptionNode(config) {
        RED.nodes.createNode(this, config);
        this.configNode = RED.nodes.getNode(config.config);
        
        this.action = config.action || "periodUsageAndCosts";
        this.siteReference = config.siteReference || "";
        this.date = config.date || "";

        this.on('input', async (msg, send, done) => {
            send = send || function() { this.send.apply(this, arguments); }.bind(this);
            done = done || function(err) { if (err) this.error(err, msg); }.bind(this);

            if (!this.configNode) {
                this.status({fill:"red", shape:"ring", text:"no config"});
                return done(new Error("Frank Energie Configuration node is required for consumption data."));
            }

            this.status({fill:"blue", shape:"dot", text:"fetching"});

            try {
                const client = await this.configNode.getClient();
                const payload = msg.payload || {};
                
                const action = payload.action || this.action;
                let siteRef = payload.siteReference || this.siteReference;
                if (!siteRef) {
                    this.log("Resolving site reference automatically...");
                    const sites = await client.getUserSites();
                    if (sites && sites.length > 0) {
                        siteRef = sites[0].reference;
                        this.log("Auto-resolved site reference: " + siteRef);
                    } else {
                        throw new Error("No site reference found on the Frank Energie account.");
                    }
                }

                let result;
                const todayStr = new Date().toISOString().split('T')[0];
                const thisMonthStr = todayStr.substring(0, 7); // YYYY-MM
                const dateStr = payload.date || this.date || (action === "monthInsights" ? thisMonthStr : todayStr);

                switch (action) {
                    case "actualAndExpectedMeterReadings":
                        result = await client.getMeterReadings(siteRef);
                        break;
                    case "monthSummary":
                        result = await client.getMonthSummary(siteRef);
                        break;
                    case "monthInsights":
                        result = await client.getMonthInsights(siteRef, dateStr);
                        break;
                    case "periodUsageAndCosts":
                        result = await client.getPeriodUsageAndCosts(siteRef, dateStr);
                        break;
                    default:
                        throw new Error("Unknown action: " + action);
                }

                msg.payload = result;
                this.status({});
                send(msg);
                done();
            } catch (error) {
                this.status({fill:"red", shape:"ring", text: error.message || "error"});
                done(error);
            }
        });
    }
    RED.nodes.registerType("smiles-frank-energie-consumption", FrankEnergieConsumptionNode);

    // 4. Smart Controls Node
    function FrankEnergieSmartControlsNode(config) {
        RED.nodes.createNode(this, config);
        this.configNode = RED.nodes.getNode(config.config);
        
        this.action = config.action || "getSmartBatteries";
        this.deviceId = config.deviceId || "";
        this.siteReference = config.siteReference || "";
        this.settings = config.settings || "";

        this.on('input', async (msg, send, done) => {
            send = send || function() { this.send.apply(this, arguments); }.bind(this);
            done = done || function(err) { if (err) this.error(err, msg); }.bind(this);

            if (!this.configNode) {
                this.status({fill:"red", shape:"ring", text:"no config"});
                return done(new Error("Frank Energie Configuration node is required for smart controls."));
            }

            this.status({fill:"blue", shape:"dot", text:"running"});

            try {
                const client = await this.configNode.getClient();
                const payload = msg.payload || {};
                
                const action = payload.action || this.action;
                const deviceId = payload.deviceId || payload.id || this.deviceId;
                
                // parse settings object
                let settings = payload.settings || payload.input;
                if (!settings && this.settings) {
                    try {
                        settings = JSON.parse(this.settings);
                    } catch (e) {
                        settings = this.settings;
                    }
                }
                
                let result;
                switch (action) {
                    case "getSmartBatteries":
                        result = await client.getSmartBatteries();
                        break;
                    case "getSmartBatteryDetails":
                        if (!deviceId) throw new Error("deviceId/id must be provided for getSmartBatteryDetails");
                        result = await client.getSmartBatteryDetails(deviceId);
                        break;
                    case "updateSmartBatterySettings":
                        if (!deviceId) throw new Error("deviceId/id must be provided for updateSmartBatterySettings");
                        if (!settings || typeof settings !== 'object') {
                            throw new Error("settings object must be provided for updateSmartBatterySettings");
                        }
                        result = await client.updateSmartBatterySettings(deviceId, settings);
                        break;
                    case "getSmartHvacStatus":
                        result = await client.getSmartHvacStatus();
                        break;
                    case "updateSmartHvacSettings":
                        if (!deviceId) throw new Error("deviceId/id must be provided for updateSmartHvacSettings");
                        if (!settings || typeof settings !== 'object') {
                            throw new Error("settings object must be provided for updateSmartHvacSettings");
                        }
                        result = await client.updateSmartHvacSettings(deviceId, settings);
                        break;
                    case "getEnodeVehicles":
                        result = await client.getEnodeVehicles();
                        break;
                    case "getEnodeChargers": {
                        let siteRef = payload.siteReference || this.siteReference;
                        if (!siteRef) {
                            const sites = await client.getUserSites();
                            if (sites && sites.length > 0) siteRef = sites[0].reference;
                        }
                        result = await client.getEnodeChargers(siteRef);
                        break;
                    }
                    case "updateVehicleChargeSettings": {
                        let input = payload.input || payload.settings || settings;
                        if (!input || typeof input !== 'object') {
                            input = { id: deviceId };
                        }
                        if (!input.id) {
                            throw new Error("input object or deviceId/id must be provided with id property");
                        }
                        result = await client.updateVehicleChargeSettings(input);
                        break;
                    }
                    case "updateChargerChargeSettings": {
                        let input = payload.input || payload.settings || settings;
                        if (!input || typeof input !== 'object') {
                            input = { id: deviceId };
                        }
                        if (!input.id) {
                            throw new Error("input object or deviceId/id must be provided with id property");
                        }
                        result = await client.updateChargerChargeSettings(input);
                        break;
                    }
                    default:
                        throw new Error("Unknown action: " + action);
                }

                msg.payload = result;
                this.status({});
                send(msg);
                done();
            } catch (error) {
                this.status({fill:"red", shape:"ring", text: error.message || "error"});
                done(error);
            }
        });
    }
    RED.nodes.registerType("smiles-frank-energie-smart-controls", FrankEnergieSmartControlsNode);
};
