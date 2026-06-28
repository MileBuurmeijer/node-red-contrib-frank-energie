const FrankEnergieClient = require('../lib/frank-energie-client');

async function testPublicPrices() {
    console.log("----------------------------------------");
    console.log("Testing Frank Energie public prices query...");
    const client = new FrankEnergieClient();

    try {
        const todayStr = new Date().toISOString().split('T')[0];
        console.log(`Fetching market prices for date: ${todayStr} with resolution PT60M...`);
        const prices = await client.getMarketPrices(todayStr, "PT60M");

        if (!prices) {
            throw new Error("No pricing data received.");
        }

        console.log("\nSuccess! Received marketPrices structure:");
        console.log(`- Electricity price periods count: ${prices.electricityPrices ? prices.electricityPrices.length : 0}`);
        console.log(`- Gas price periods count: ${prices.gasPrices ? prices.gasPrices.length : 0}`);
        
        if (prices.averageElectricityPrices) {
            console.log(`- Average electricity price: ${prices.averageElectricityPrices.averageMarketPrice} EUR`);
        }

        if (prices.electricityPrices && prices.electricityPrices.length > 0) {
            const firstPrice = prices.electricityPrices[0];
            console.log(`- First electricity period: ${firstPrice.from} to ${firstPrice.till}`);
            console.log(`  Market Price: ${firstPrice.marketPrice} EUR`);
        }

        if (prices.gasPrices && prices.gasPrices.length > 0) {
            const firstGas = prices.gasPrices[0];
            console.log(`- First gas period: ${firstGas.from} to ${firstGas.till}`);
            console.log(`  Market Price: ${firstGas.marketPrice} EUR`);
        }
        
        console.log("\nTest passed successfully.");
    } catch (e) {
        console.error("Test failed: ", e.message);
        process.exit(1);
    }
}

async function testAuthenticatedMethods() {
    console.log("----------------------------------------");
    console.log("Testing structure of all client methods (Mocked HTTP)...");
    
    const client = new FrankEnergieClient({
        authToken: "mock.header.payload",
        refreshToken: "mock.header.payload"
    });

    const requests = [];
    
    // Intercept client's request method to inspect GraphQL payload without hitting network
    client.request = async (query, operationName, variables, extraHeaders) => {
        requests.push({ operationName, variables, extraHeaders });
        return { data: {} };
    };

    try {
        console.log("Asserting query builders...");

        // Consumption
        await client.getMeterReadings("S-12345");
        await client.getMonthSummary("S-12345");
        await client.getMonthInsights("S-12345", "2026-06");
        await client.getPeriodUsageAndCosts("S-12345", "2026-06-28");

        // Smart Controls
        await client.getSmartBatteries();
        await client.getSmartBatteryDetails("B-9999");
        await client.updateSmartBatterySettings("B-9999", { batteryMode: "SMART" });
        await client.getSmartHvacStatus();
        await client.updateSmartHvacSettings("H-9999", { mode: "SMART" });
        await client.getEnodeVehicles();
        await client.getEnodeChargers("S-12345");
        await client.updateVehicleChargeSettings({ id: "V-9999", isSmartChargingEnabled: true });
        await client.updateChargerChargeSettings({ id: "C-9999", isSmartChargingEnabled: true });

        console.log(`- Total intercepted queries checked: ${requests.length}`);
        
        // Assert some key mappings
        const batteryUpdate = requests.find(r => r.operationName === "SmartBatteryUpdateSettings");
        if (!batteryUpdate || batteryUpdate.variables.deviceId !== "B-9999") {
            throw new Error("SmartBatteryUpdateSettings failed variables assertion");
        }

        const vehicleUpdate = requests.find(r => r.operationName === "EnodeUpdateVehicleChargeSettings");
        if (!vehicleUpdate || vehicleUpdate.variables.input.vehicleId !== "V-9999" || vehicleUpdate.variables.input.id !== undefined) {
            throw new Error("VehicleChargeSettings mapping from 'id' to 'vehicleId' assertion failed");
        }

        const chargerUpdate = requests.find(r => r.operationName === "EnodeUpdateChargerChargeSettings");
        if (!chargerUpdate || chargerUpdate.variables.input.chargerId !== "C-9999" || chargerUpdate.variables.input.id !== undefined) {
            throw new Error("ChargerChargeSettings mapping from 'id' to 'chargerId' assertion failed");
        }

        console.log("\nAll mock assertions passed successfully.");
    } catch (e) {
        console.error("Authenticated client methods check failed: ", e.message);
        process.exit(1);
    }
}

async function main() {
    await testPublicPrices();
    await testAuthenticatedMethods();
}

main();
