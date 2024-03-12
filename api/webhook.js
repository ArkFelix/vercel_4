// api/webhook.js

import { SmartAPI } from '../smartapi-javascript';
import logzero from 'logzero';
import fs from 'fs';

// Load environment variables from credentials.txt
const credentials = parse(fs.readFileSync('credentials.txt', 'utf-8'));

// Function to fetch JSON data from URL
const fetchJsonData = async (url) => {
    try {
        const response = await fetch(url);
        if (response.ok) {
            return await response.json();
        } else {
            logger.error("Failed to fetch JSON data");
            return null;
        }
    } catch (error) {
        logger.error(`Error fetching JSON data: ${error}`);
        return null;
    }
};

// Function to fetch symbol token from JSON data
const fetchSymbolToken = async (stockSymbol) => {
    const jsonUrl = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
    const jsonData = await fetchJsonData(jsonUrl);

    if (!jsonData) {
        logger.error("Failed to fetch JSON data.");
        return null;
    }

    const symbolData = jsonData.find(item => item.name.toUpperCase() === stockSymbol.toUpperCase());
    if (symbolData) {
        const tradingSymbol = symbolData.symbol;
        const symbolToken = symbolData.token;
        return { tradingSymbol, symbolToken };
    }

    logger.warn("Symbol token not found for the stock symbol.");
    return null;
};

// Function to calculate quantity
const calculateQuantity = (price) => {
    const availableFunds = parseFloat(credentials.OrderDetails.available_funds) || 0;
    const quantity = Math.max(Math.floor(availableFunds / parseFloat(price)), 1);
    return quantity;
};

// Function to process stock order
const processStockOrder = async (stockName, price) => {
    const apiKey = credentials.SmartAPI.api_key;
    const username = credentials.SmartAPI.username;
    const password = credentials.SmartAPI.password;
    const demoToken = credentials.SmartAPI.demo_token;

    const smartApi = new SmartAPI({
        api_key: apiKey
    });

    try {
        const totp = pyotp.TOTP(demoToken).now();
        const data = smartApi.generateSession(username, password, totp);
        if (data.status === false) {
            logger.error(data);
        } else {
            const authToken = data.data.jwtToken;
            const refreshToken = data.data.refreshToken;

            const { tradingSymbol, symbolToken } = await fetchSymbolToken(stockName.split("-")[0]);
            if (!symbolToken) {
                logger.error("Symbol Token not found for the stock symbol.");
                return;
            }

            const quantity = calculateQuantity(price);
            logger.info(`Placing order for ${quantity} shares of ${stockName}...`);

            const orderparams = {
                variety: "NORMAL",
                tradingsymbol: tradingSymbol,
                symboltoken: symbolToken,
                transactiontype: credentials.OrderDetails.transaction_type,
                exchange: "NSE",
                ordertype: "MARKET",
                producttype: credentials.OrderDetails.product_type,
                duration: "DAY",
                price: "0",
                squareoff: "0",
                stoploss: "0",
                quantity: quantity
            };
            const response = smartApi.placeOrderFullResponse(orderparams);
            if (typeof response === "string") {
                response = JSON.parse(response);
            }

            const orderTime = response.data.orderCreationTime;
            if (orderTime) {
                logger.info(`Order placed successfully at: ${orderTime}`);
            } else {
                logger.info("Order placement failed.");
            }
        }
    } catch (error) {
        logger.error(`Order placement failed: ${error}`);
    }
};

// Function to handle webhook requests
export default async function handler(req, res) {
    if (req.method === 'POST') {
        const receivedTimeUTC = new Date();
        const receivedTimeIST = receivedTimeUTC.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        logger.info('Received webhook at (IST):', receivedTimeIST);

        const alertData = req.body;
        logger.info('Received alert:', alertData);

        const stockName = alertData.stockName;
        const price = alertData.price;
        if (stockName && price) {
            await processStockOrder(stockName, price);
        }

        res.status(200).json({ message: 'Alert received successfully' });
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end('Method Not Allowed');
    }
}